import { randomUUID } from "node:crypto";
import { minutesToSeconds } from "date-fns";
import type Redis from "ioredis";
import { BUSY_TIMES_RETENTION_SECONDS, ORDERS_RETENTION_SECONDS, TIME_FRAME_SECONDS_OFFSET } from "../constants";
import { decodeBusyTime, decodeOrder, encodeBusyTime, encodeOrder } from "../encoder";
import { type Logger, noopLogger } from "../logger";
import type { Rule } from "../rules/types";
import { matchesCategories, matchesTags, secondsToDate, toSeconds } from "../utils";
import EngineRules from "./EngineRules";
import { type BusyTime, type InputOrder, type Order, OrderSource, TimeframeMode, type TimeWindow } from "./types";

type EngineParams = {
	bucket: string;
	redis: Redis;
	logger?: Logger;
	timeframeMode?: TimeframeMode;
	busyTimeMode?: TimeframeMode;
	timeZone?: string;
	rules?: Rule[];
};

type ValidateOrderTimeParams = {
	orderTime: Date;
	tags?: string[];
	categoryIds?: string[];
};

export class Engine {
	private engineRules: EngineRules;

	private redis: Redis;
	private logger: Logger;
	private timeframeMode: TimeframeMode;
	private busyTimeMode: TimeframeMode;
	private timeZone: string;

	private ordersKey: string;
	private busyTimesKey: string;

	constructor({
		bucket,
		redis,
		logger = noopLogger,
		timeframeMode = TimeframeMode.BEFORE_ONLY,
		busyTimeMode = TimeframeMode.BEFORE_ONLY,
		timeZone = "UTC",
		rules = [],
	}: EngineParams) {
		this.redis = redis;
		this.logger = logger;
		this.timeframeMode = timeframeMode;
		this.busyTimeMode = busyTimeMode;
		this.timeZone = timeZone;
		this.engineRules = new EngineRules(rules);

		this.ordersKey = `orders:${bucket}`;
		this.busyTimesKey = `busytimes:${bucket}`;
	}

	private static calculateTimeWindow({
		orderTimeSeconds,
		timeFrameSeconds,
		timeframeMode,
	}: {
		orderTimeSeconds: number;
		timeFrameSeconds: number;
		timeframeMode: TimeframeMode;
	}): TimeWindow {
		switch (timeframeMode) {
			case TimeframeMode.CENTERED: {
				return {
					start: orderTimeSeconds - Math.floor(timeFrameSeconds / 2),
					end: orderTimeSeconds + Math.floor(timeFrameSeconds / 2),
				};
			}
			case TimeframeMode.BEFORE_ONLY:
				return {
					start: orderTimeSeconds - timeFrameSeconds,
					end: orderTimeSeconds,
				};
			case TimeframeMode.AFTER_ONLY:
				return {
					start: orderTimeSeconds,
					end: orderTimeSeconds + timeFrameSeconds,
				};
			case TimeframeMode.BEFORE_AND_AFTER:
				return {
					start: orderTimeSeconds - timeFrameSeconds,
					end: orderTimeSeconds + timeFrameSeconds,
				};
		}
	}

	/**
	 * Where a tripped rule's busy period sits around the order that tripped it: `busyTimeMinutes`
	 * before it (BEFORE_ONLY), after it (AFTER_ONLY), split across it (CENTERED) or on both sides
	 * (BEFORE_AND_AFTER). It never ends before `busyTimeMinutes` from now, so an order placed for
	 * right away still blocks the time just ahead.
	 */
	private static calculateBusyWindow({
		orderTimeSeconds,
		currentTimeSeconds,
		busyTimeSeconds,
		busyTimeMode,
	}: {
		orderTimeSeconds: number;
		currentTimeSeconds: number;
		busyTimeSeconds: number;
		busyTimeMode: TimeframeMode;
	}): { startTimeSeconds: number; endTimeSeconds: number } {
		const [beforeSeconds, afterSeconds] = {
			[TimeframeMode.BEFORE_ONLY]: [busyTimeSeconds, 0],
			[TimeframeMode.AFTER_ONLY]: [0, busyTimeSeconds],
			[TimeframeMode.CENTERED]: [Math.floor(busyTimeSeconds / 2), Math.ceil(busyTimeSeconds / 2)],
			[TimeframeMode.BEFORE_AND_AFTER]: [busyTimeSeconds, busyTimeSeconds],
		}[busyTimeMode];
		const endTimeSeconds = Math.max(orderTimeSeconds + afterSeconds, currentTimeSeconds + busyTimeSeconds);

		return { startTimeSeconds: endTimeSeconds - beforeSeconds - afterSeconds, endTimeSeconds };
	}

	private async getOrdersInWindow(timeWindow: TimeWindow): Promise<Order[]> {
		const entries = await this.redis.zrangebyscoreBuffer(
			this.ordersKey,
			timeWindow.start,
			timeWindow.end,
			"WITHSCORES",
		);

		const orders: Order[] = [];

		for (let i = 0; i < entries.length; i += 2) {
			const value = entries[i] as Buffer;
			const order = decodeOrder(value);

			if (order.source === OrderSource.PERDIEM) {
				orders.push(order);
			}
		}

		return orders;
	}

	private async cleanOldOrders(currentTimeSeconds: number): Promise<void> {
		const retentionTimeSeconds = currentTimeSeconds - ORDERS_RETENTION_SECONDS;

		await this.redis.zremrangebyscore(this.ordersKey, 0, retentionTimeSeconds);
	}

	private async cleanOldBusyTimes(currentTimeSeconds: number): Promise<void> {
		await this.redis.zremrangebyscore(this.busyTimesKey, 0, currentTimeSeconds - BUSY_TIMES_RETENTION_SECONDS);
	}

	private async addOrder(order: Order): Promise<void> {
		const buffer = encodeOrder(order);

		await this.redis.zadd(this.ordersKey, order.orderTimeSeconds, buffer);
	}

	private async addBusyTime(busyTime: BusyTime): Promise<void> {
		const buffer = encodeBusyTime(busyTime);

		await this.redis.zadd(this.busyTimesKey, busyTime.orderTimeSeconds, buffer);
	}

	public async add(inputOrder: InputOrder): Promise<void> {
		if (!(inputOrder.orderTime instanceof Date) || Number.isNaN(inputOrder.orderTime.getTime())) {
			throw new TypeError("orderTime must be a valid Date");
		}

		if (typeof inputOrder.orderId !== "string" || inputOrder.orderId.length === 0) {
			throw new TypeError("orderId must be a non-empty string");
		}

		if (!Array.isArray(inputOrder.tags) || inputOrder.tags.some((tag) => typeof tag !== "string" || tag.length === 0)) {
			throw new TypeError("tags must be an array of non-empty strings");
		}

		const orderTimeSeconds = toSeconds(inputOrder.orderTime);
		const currentTimeSeconds = toSeconds(Date.now());

		await this.cleanOldOrders(currentTimeSeconds);
		await this.cleanOldBusyTimes(currentTimeSeconds);

		const order: Order = { ...inputOrder, currentTimeSeconds, orderTimeSeconds };

		await this.addOrder(order);

		if (!this.engineRules.hasRules() || order.source !== OrderSource.PERDIEM) {
			this.logger.debug("No busy-time rules configured or order source is not PERDIEM; skipping busy-time evaluation");

			return;
		}

		for (const engineRule of this.engineRules.getEngineRules()) {
			if (!engineRule.applyCheck(order, this.timeZone)) {
				continue;
			}

			const timeFrameSeconds = minutesToSeconds(engineRule.rule.timeFrameMinutes) - TIME_FRAME_SECONDS_OFFSET;

			const timeWindow = Engine.calculateTimeWindow({
				orderTimeSeconds,
				timeFrameSeconds,
				timeframeMode: this.timeframeMode,
			});

			const ordersInWindow = await this.getOrdersInWindow(timeWindow);

			const thresholdInfo = engineRule.thresholdCheck(ordersInWindow);

			if (!thresholdInfo) {
				continue;
			}

			const busyTimeSeconds = minutesToSeconds(engineRule.rule.busyTimeMinutes);
			const { startTimeSeconds, endTimeSeconds } = Engine.calculateBusyWindow({
				orderTimeSeconds,
				currentTimeSeconds,
				busyTimeSeconds: busyTimeSeconds - TIME_FRAME_SECONDS_OFFSET,
				busyTimeMode: this.busyTimeMode,
			});

			await this.addBusyTime({
				busyTimeId: randomUUID(),
				ruleId: engineRule.rule.ruleId,
				startTime: secondsToDate(startTimeSeconds),
				endTime: secondsToDate(endTimeSeconds),
				orderTimeSeconds,
				currentTimeSeconds,
				busyTimeSeconds,
				scope: engineRule.scope,
				threshold: thresholdInfo.threshold,
				busyTimeContext: thresholdInfo.busyTimeContext,
			});
		}
	}

	public async getOrders(): Promise<Order[]> {
		const currentTimeSeconds = toSeconds(Date.now());

		await this.cleanOldOrders(currentTimeSeconds);

		const entries = await this.redis.zrangeBuffer(this.ordersKey, 0, -1, "WITHSCORES");

		const orders: Order[] = [];

		for (let i = 0; i < entries.length; i += 2) {
			const value = entries[i] as Buffer;
			const order = decodeOrder(value);

			orders.push(order);
		}

		return orders;
	}

	public async getBusyTimes(): Promise<BusyTime[]> {
		const currentTimeSeconds = toSeconds(Date.now());

		await this.cleanOldBusyTimes(currentTimeSeconds);

		const entries = await this.redis.zrangeBuffer(this.busyTimesKey, 0, -1, "WITHSCORES");

		const busyTimes: BusyTime[] = [];

		for (let i = 0; i < entries.length; i += 2) {
			const value = entries[i] as Buffer;
			const busyTime = decodeBusyTime(value);

			busyTimes.push(busyTime);
		}

		return busyTimes.sort((a, b) => toSeconds(a.startTime) - toSeconds(b.startTime));
	}

	public async getOrdersStats(
		startTime: Date,
		endTime: Date,
	): Promise<{ orderId: string; orderTime: Date; source: OrderSource }[]> {
		const startTimeSeconds = toSeconds(startTime);
		const endTimeSeconds = toSeconds(endTime);
		const currentTimeSeconds = toSeconds(Date.now());

		await this.cleanOldOrders(currentTimeSeconds);

		const entries = await this.redis.zrangebyscoreBuffer(
			this.ordersKey,
			startTimeSeconds,
			endTimeSeconds,
			"WITHSCORES",
		);

		const orders: {
			orderId: string;
			orderTime: Date;
			source: OrderSource;
		}[] = [];

		for (let i = 0; i < entries.length; i += 2) {
			const value = entries[i] as Buffer;
			const order = decodeOrder(value);

			orders.push({
				orderId: order.orderId,
				orderTime: order.orderTime,
				source: order.source,
			});
		}

		return orders.sort((a, b) => toSeconds(a.orderTime) - toSeconds(b.orderTime));
	}

	public async validateOrderTime({
		orderTime,
		tags = [],
		categoryIds,
	}: ValidateOrderTimeParams): Promise<{ waitPeriodSeconds: number; ordersInWindow: number }> {
		if (!(orderTime instanceof Date) || Number.isNaN(orderTime.getTime())) {
			throw new TypeError("orderTime must be a valid Date");
		}

		if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || tag.length === 0)) {
			throw new TypeError("tags must be an array of non-empty strings");
		}

		if (
			categoryIds !== undefined &&
			(!Array.isArray(categoryIds) ||
				categoryIds.some((categoryId) => typeof categoryId !== "string" || categoryId.length === 0))
		) {
			throw new TypeError("categoryIds must be an array of non-empty strings");
		}

		const orderTimeSeconds = toSeconds(orderTime);
		const busyTimes = (await this.getBusyTimes()).filter(
			(busyTime) =>
				matchesTags(busyTime.scope, tags) && matchesCategories(busyTime.threshold?.categoryIds, categoryIds),
		);

		let waitPeriodSeconds = 0;
		let ordersInWindow = 0;

		for (const busyTime of busyTimes) {
			const startTimeSeconds = toSeconds(busyTime.startTime);
			const endTimeSeconds = toSeconds(busyTime.endTime);
			const orderTimeSecondsWithOffset = orderTimeSeconds + waitPeriodSeconds;

			if (orderTimeSecondsWithOffset < startTimeSeconds) {
				break;
			}

			if (orderTimeSecondsWithOffset > endTimeSeconds) {
				continue;
			}

			waitPeriodSeconds = endTimeSeconds + 1 - orderTimeSeconds;
			ordersInWindow = busyTime.busyTimeContext.totalOrders;
		}

		return { waitPeriodSeconds, ordersInWindow };
	}
}
