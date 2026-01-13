import { minutesToSeconds } from "date-fns";
import type Redis from "ioredis";
import {
	decodeBusyTime,
	decodeOrder,
	encodeBusyTime,
	encodeOrder,
} from "./../encoder";
import { type Logger, noopLogger } from "../logger";
import type { Rule } from "../rules/types";
import { scoreToDate, toSeconds } from "../utils";
import EngineRules from "./EngineRules";
import {
	type BusyTime,
	type InputOrder,
	type Order,
	type OrderSource,
	TimeframeMode,
	type TimeWindow,
} from "./types";

export const ORDERS_RETENTION_SECONDS = 604800; // 7 days in seconds

type EngineParams = {
	redis: Redis;
	logger?: Logger;
	bucket: string;
	rules: Rule[];
	timeframeMode?: TimeframeMode;
	timeZone?: string;
};

export class Engine {
	private engineRules: EngineRules;
	private logger: Logger;
	private redis: Redis;
	private ordersKey: string;
	private busyTimesKey: string;
	private timeframeMode: TimeframeMode;
	private timeZone: string;

	constructor({
		redis,
		logger = noopLogger,
		rules,
		bucket,
		timeframeMode = TimeframeMode.BEFORE_ONLY,
		timeZone = "UTC",
	}: EngineParams) {
		this.engineRules = new EngineRules(rules);
		this.logger = logger;
		this.redis = redis;
		this.ordersKey = `orders:${bucket}`;
		this.busyTimesKey = `busytimes:${bucket}`;
		this.timeframeMode = timeframeMode;
		this.timeZone = timeZone;
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

	private async getOrdersInWindow(timeWindow: TimeWindow): Promise<Order[]> {
		const entries = await this.redis.zrangebyscore(
			this.ordersKey,
			timeWindow.start,
			timeWindow.end,
			"WITHSCORES",
		);

		const orders: Order[] = [];

		for (let i = 0; i < entries.length; i += 2) {
			const value = entries[i] as string;
			const order = decodeOrder(Buffer.from(value));

			orders.push(order);
		}

		return orders;
	}

	private async cleanOldOrders(currentTimeSeconds: number): Promise<void> {
		const retentionTimeSeconds = currentTimeSeconds - ORDERS_RETENTION_SECONDS;

		await this.redis.zremrangebyscore(this.ordersKey, 0, retentionTimeSeconds);
	}

	private async cleanOldBusyTimes(currentTimeSeconds: number): Promise<void> {
		await this.redis.zremrangebyscore(this.busyTimesKey, 0, currentTimeSeconds);
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
		if (!this.engineRules.hasRules()) {
			this.logger.warn("No busy time rules set, skipping order validation");
		}

		const orderTimeSeconds = toSeconds(inputOrder.orderTime);
		const currentTimeSeconds = toSeconds(Date.now());

		await this.cleanOldOrders(currentTimeSeconds);
		await this.cleanOldBusyTimes(currentTimeSeconds);

		const order: Order = Object.assign(inputOrder, {
			currentTimeSeconds,
			orderTimeSeconds,
		});

		await this.addOrder(order);

		for (const engineRule of this.engineRules.getEngineRules()) {
			if (!engineRule.doesApply(order.orderTime, this.timeZone)) {
				continue;
			}

			const timeWindow = Engine.calculateTimeWindow({
				orderTimeSeconds,
				timeFrameSeconds: minutesToSeconds(engineRule.rule.timeFrame),
				timeframeMode: this.timeframeMode,
			});

			const ordersInWindow = await this.getOrdersInWindow(timeWindow);

			if (engineRule.exceedsThreshold(ordersInWindow)) {
				const busyTimeSeconds = minutesToSeconds(engineRule.rule.prepTime);

				await this.addBusyTime({
					startTime: scoreToDate(orderTimeSeconds - busyTimeSeconds),
					endTime: scoreToDate(orderTimeSeconds),
					orderTimeSeconds,
					currentTimeSeconds,
					busyTimeSeconds,
				});
			}
		}
	}

	public async getOrders(): Promise<Order[]> {
		const currentTimeSeconds = toSeconds(Date.now());

		await this.cleanOldOrders(currentTimeSeconds);

		const entries = await this.redis.zrange(
			this.ordersKey,
			0,
			-1,
			"WITHSCORES",
		);

		const orders: Order[] = [];

		for (let i = 0; i < entries.length; i += 2) {
			const value = entries[i] as string;
			const order = decodeOrder(Buffer.from(value));

			orders.push(order);
		}

		return orders;
	}

	public async getBusyTimes(): Promise<BusyTime[]> {
		const currentTimeSeconds = toSeconds(Date.now());

		await this.cleanOldBusyTimes(currentTimeSeconds);

		const entries = await this.redis.zrange(
			this.busyTimesKey,
			0,
			-1,
			"WITHSCORES",
		);

		const busyTimes: BusyTime[] = [];

		for (let i = 0; i < entries.length; i += 2) {
			const value = entries[i] as string;
			const busyTime = decodeBusyTime(Buffer.from(value));

			busyTimes.push(busyTime);
		}

		return busyTimes.sort(
			(a, b) => toSeconds(a.startTime) - toSeconds(b.startTime),
		);
	}

	public async getOrdersStats(
		startTime: Date,
		endTime: Date,
	): Promise<{ orderId: string; orderTime: Date; source: OrderSource }[]> {
		const startTimeSeconds = toSeconds(startTime);
		const endTimeSeconds = toSeconds(endTime);
		const currentTimeSeconds = toSeconds(Date.now());

		await this.cleanOldOrders(currentTimeSeconds);

		const entries = await this.redis.zrangebyscore(
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
			const value = entries[i] as string;
			const score = parseInt(entries[i + 1] as string, 10);
			const orderTime = scoreToDate(score);
			const order = decodeOrder(Buffer.from(value));

			orders.push({ orderId: order.orderId, orderTime, source: order.source });
		}

		return orders.sort(
			(a, b) => toSeconds(a.orderTime) - toSeconds(b.orderTime),
		);
	}

	public async validateOrderTime(
		orderTime: Date,
	): Promise<{ waitPeriodSeconds: number; ordersInWindow: number }> {
		const orderTimeSeconds = toSeconds(orderTime);
		const busyTimes = await this.getBusyTimes();

		const waitPeriodInfo = {
			waitPeriodSeconds: 0,
			ordersInWindow: 0,
		};

		for (const busyTime of busyTimes) {
			const startTimeSeconds = toSeconds(busyTime.startTime);
			const endTimeSeconds = toSeconds(busyTime.endTime);
			const orderTimeSecondsWithOffset =
				orderTimeSeconds + waitPeriodInfo.waitPeriodSeconds;

			if (
				orderTimeSecondsWithOffset >= startTimeSeconds &&
				orderTimeSecondsWithOffset <= endTimeSeconds
			) {
				waitPeriodInfo.waitPeriodSeconds =
					endTimeSeconds + 1 - orderTimeSeconds;
				continue;
			}

			break;
		}

		return {
			waitPeriodSeconds: waitPeriodInfo.waitPeriodSeconds,
			ordersInWindow: waitPeriodInfo.ordersInWindow,
		};
	}
}
