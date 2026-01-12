import { getDay, getHours, getMinutes } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import type Redis from "ioredis";
import { pack, unpack } from "msgpackr";
import type { Logger } from "./logger";
import { noopLogger } from "./logger";
import { defaultRuleSet } from "./rules";
import type { Rule } from "./rules/types";
import {
	minutesToSeconds,
	scoreToDate,
	timeStringToMinutes,
	toSeconds,
} from "./utils";

export const TIMEFRAME_MODE = {
	CENTERED: "centered",
	BEFORE_ONLY: "before_only",
	AFTER_ONLY: "after_only",
	BEFORE_AND_AFTER: "before_and_after",
} as const;

export type TimeframeCalculationMode =
	(typeof TIMEFRAME_MODE)[keyof typeof TIMEFRAME_MODE];

export const ORDER_SOURCE = {
	PERDIEM: "perdiem",
	OTHER: "other",
} as const;

export type OrderSource = (typeof ORDER_SOURCE)[keyof typeof ORDER_SOURCE];

export const ORDERS_RETENTION_SECONDS = 604800; // 7 days in seconds

export interface OrderItem {
	itemId: string;
	categoryId: string;
	quantity: number;
	price: number;
}

export interface BaseOrder {
	orderId: string;
	items: OrderItem[];
	source: OrderSource;
}

export interface Order extends BaseOrder {
	orderTime: Date;
	totalAmountCents: number;
}

export interface OrderEntry {
	orderId: string;
	orderTime: Date;
	itemsCount?: number;
	totalPrice?: number;
}

export interface BusyTimeEntry {
	startTime: Date;
	endTime: Date;
	busyTime: number;
}

export interface OrderData extends BaseOrder {
	orderTime: Date;
	currentTimeSeconds: number;
	totalAmountCents: number;
}

export interface BusyTimeData {
	orderTimeSeconds: number;
	currentTimeSeconds: number;
	prepTime: number;
}

export interface RedisOrder extends BaseOrder {
	currentTimeSeconds: number;
	totalPrice: number;
}

export interface RedisOrderValue {
	orderId: string;
	currentTimeSeconds: number;
	itemsCount?: number;
	totalPrice?: number;
	categoryIds?: string[];
}

export interface RedisBusyTimeValue {
	currentTimeSeconds: number;
	busyTime: number;
}

export interface TimeWindow {
	start: number;
	end: number;
}

export interface WaitPeriodInfo {
	waitPeriodSeconds: number;
	ordersInWindow: number;
}

export interface EngineParams {
	redis: Redis;
	logger?: Logger;
	bucket: string;
	timeframeMode?: TimeframeCalculationMode;
	timeZone?: string;
}

export class Engine {
	/**
	 * Redis client
	 */
	private readonly redis: Redis;

	/**
	 * Logger
	 */
	private readonly logger: Logger;

	/**
	 * Bucket name
	 */
	private readonly bucket: string;

	/**
	 * Timeframe mode
	 */
	private readonly timeframeMode: TimeframeCalculationMode;

	/**
	 * Timezone
	 */
	private readonly timeZone: string;

	/**
	 * Redis key for orders
	 */
	private readonly ordersKey: string;

	/**
	 * Redis key for busy times
	 */
	private readonly busyTimesKey: string;

	/**
	 * Busy time rules (supports multiple rules with overlapping)
	 */
	private rules: Rule[] = [];

	constructor({
		redis,
		logger = noopLogger,
		bucket,
		timeframeMode = TIMEFRAME_MODE.BEFORE_ONLY,
		timeZone = "UTC",
	}: EngineParams) {
		this.redis = redis;
		this.logger = logger;
		this.bucket = bucket;
		this.timeframeMode = timeframeMode;
		this.timeZone = timeZone;
		this.ordersKey = `orders:${this.bucket}`;
		this.busyTimesKey = `busytimes:${this.bucket}`;
	}

	public setRules(rules: Rule[]): void {
		if (!rules || rules.length === 0) {
			throw new Error("At least one busy time rule must be provided");
		}

		for (const rule of rules) {
			defaultRuleSet.validate(rule);
		}

		this.rules = rules;
	}

	public async validateOrder(order: Order): Promise<void> {
		if (!this.rules || this.rules.length === 0) {
			this.logger.warn("No busy time rules set, using defaults");
		}

		const orderTimeSeconds = toSeconds(order.orderTime);
		const currentTimeSeconds = toSeconds(Date.now());

		await this.cleanOldOrders(currentTimeSeconds);
		await this.cleanOldBusyTimes(currentTimeSeconds);

		const orderData: OrderData = { ...order, currentTimeSeconds };
		await this.addOrder(orderData);

		for (const rule of this.rules) {
			if (!this.isRuleActive(rule, order.orderTime)) {
				continue;
			}

			const timeWindow = this.calculateTimeWindow({
				orderTimeSeconds,
				timeFrameSeconds: minutesToSeconds(rule.timeFrame),
			});

			const ordersInWindow = await this.getOrdersInWindow(timeWindow);

			if (this.exceedsThreshold(ordersInWindow, rule)) {
				const busyTimeData: BusyTimeData = {
					orderTimeSeconds,
					currentTimeSeconds,
					prepTime: rule.prepTime,
				};

				await this.addBusyTime(busyTimeData);
			}
		}
	}

	public async validateOrderTime(orderTime: Date): Promise<WaitPeriodInfo> {
		const orderTimeSeconds = toSeconds(orderTime);
		const busyTimeEntries = await this.getBusyTimes();

		const waitPeriodInfo = {
			waitPeriodSeconds: 0,
			ordersInWindow: 0,
		};

		for (const busyTimeEntry of busyTimeEntries) {
			const startTimeSeconds = toSeconds(busyTimeEntry.startTime);
			const endTimeSeconds = toSeconds(busyTimeEntry.endTime);
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

	public async getBusyTimes(): Promise<BusyTimeEntry[]> {
		const currentTimeSeconds = toSeconds(Date.now());

		await this.cleanOldBusyTimes(currentTimeSeconds);

		const entries = await this.redis.zrange(
			this.busyTimesKey,
			0,
			-1,
			"WITHSCORES",
		);

		const busyTimes: BusyTimeEntry[] = [];

		for (let i = 0; i < entries.length; i += 2) {
			const value = entries[i] as string;
			const score = parseInt(entries[i + 1] as string, 10);
			const { startTime, endTime, busyTime } = this.parseBusyTimeValue(
				value,
				score,
			);

			busyTimes.push({
				startTime,
				endTime,
				busyTime,
			});
		}

		return busyTimes.sort(
			(a, b) => toSeconds(a.startTime) - toSeconds(b.startTime),
		);
	}

	public async getOrders(): Promise<OrderEntry[]> {
		const currentTimeSeconds = toSeconds(Date.now());

		await this.cleanOldOrders(currentTimeSeconds);

		const entries = await this.redis.zrange(
			this.ordersKey,
			0,
			-1,
			"WITHSCORES",
		);

		const orders: OrderEntry[] = [];

		for (let i = 0; i < entries.length; i += 2) {
			const value = entries[i] as string;
			const score = parseInt(entries[i + 1] as string, 10);
			const { orderId, orderTime, items } = this.parseOrderValue(value, score);

			const itemsCount = items.reduce((sum, item) => sum + item.quantity, 0);
			const totalPrice = items.reduce(
				(sum, item) => sum + item.price * item.quantity,
				0,
			);

			orders.push({
				orderId,
				orderTime,
				itemsCount,
				totalPrice,
			});
		}

		return orders;
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

		const allOrders: {
			orderId: string;
			orderTime: Date;
			source: OrderSource;
		}[] = [];

		for (let i = 0; i < entries.length; i += 2) {
			const value = entries[i] as string;
			const score = parseInt(entries[i + 1] as string, 10);
			const { orderId, orderTime, source } = this.parseOrderValue(value, score);

			allOrders.push({ orderId, orderTime, source });
		}

		return allOrders.sort(
			(a, b) => toSeconds(a.orderTime) - toSeconds(b.orderTime),
		);
	}

	private getOrderValue(orderData: OrderData): Buffer {
		return pack({
			orderId: orderData.orderId,
			currentTimeSeconds: orderData.currentTimeSeconds,
			items: orderData.items,
			totalPrice: orderData.totalAmountCents,
			source: orderData.source || ORDER_SOURCE.PERDIEM,
		});
	}

	private getBusyTimeValue(busyTimeData: BusyTimeData): string {
		return `${busyTimeData.currentTimeSeconds}:${busyTimeData.prepTime}`;
	}

	private parseOrderValue(value: Buffer | string, score: number) {
		const data = unpack(Buffer.from(value)) as RedisOrder;

		return {
			orderId: data.orderId,
			orderTime: scoreToDate(score),
			currentTimeSeconds: data.currentTimeSeconds,
			items: data.items,
			totalPrice: data.totalPrice,
			source: data.source || ORDER_SOURCE.PERDIEM,
		};
	}

	private parseBusyTimeValue(value: string, score: number): BusyTimeEntry {
		const [, prepTimeStr] = value.split(":");
		const prepTime = parseInt(prepTimeStr, 10);
		const orderTime = scoreToDate(score);

		const startTime = scoreToDate(score - minutesToSeconds(prepTime));
		const endTime = orderTime;

		return {
			startTime,
			endTime,
			busyTime: prepTime,
		};
	}

	private async cleanOldOrders(currentTimeSeconds: number): Promise<void> {
		await this.redis.zremrangebyscore(
			this.ordersKey,
			0,
			currentTimeSeconds - ORDERS_RETENTION_SECONDS,
		);
	}

	private async cleanOldBusyTimes(currentTimeSeconds: number): Promise<void> {
		await this.redis.zremrangebyscore(this.busyTimesKey, 0, currentTimeSeconds);
	}

	private async addOrder(orderData: OrderData): Promise<void> {
		const { orderTime } = orderData;

		const orderValue = this.getOrderValue(orderData);
		const orderTimeSeconds = toSeconds(orderTime);

		await this.redis.zadd(this.ordersKey, orderTimeSeconds, orderValue);
	}

	private async addBusyTime(busyTimeData: BusyTimeData): Promise<void> {
		const busyTimeValue = this.getBusyTimeValue(busyTimeData);

		await this.redis.zadd(
			this.busyTimesKey,
			busyTimeData.orderTimeSeconds,
			busyTimeValue,
		);
	}

	private calculateTimeWindow({
		orderTimeSeconds,
		timeFrameSeconds,
	}: {
		orderTimeSeconds: number;
		timeFrameSeconds: number;
	}): TimeWindow {
		switch (this.timeframeMode) {
			case TIMEFRAME_MODE.CENTERED: {
				return {
					start: orderTimeSeconds - Math.floor(timeFrameSeconds / 2),
					end: orderTimeSeconds + Math.floor(timeFrameSeconds / 2),
				};
			}
			case TIMEFRAME_MODE.BEFORE_ONLY:
				return {
					start: orderTimeSeconds - timeFrameSeconds,
					end: orderTimeSeconds,
				};
			case TIMEFRAME_MODE.AFTER_ONLY:
				return {
					start: orderTimeSeconds,
					end: orderTimeSeconds + timeFrameSeconds,
				};
			case TIMEFRAME_MODE.BEFORE_AND_AFTER:
				return {
					start: orderTimeSeconds - timeFrameSeconds,
					end: orderTimeSeconds + timeFrameSeconds,
				};
		}
	}

	private async getOrdersInWindow(
		timeWindow: TimeWindow,
	): Promise<RedisOrderValue[]> {
		const entries = await this.redis.zrangebyscore(
			this.ordersKey,
			timeWindow.start,
			timeWindow.end,
			"WITHSCORES",
		);

		const orders: RedisOrderValue[] = [];

		for (let i = 0; i < entries.length; i += 2) {
			const value = entries[i] as string;
			const score = parseInt(entries[i + 1] as string, 10);
			const { orderId, currentTimeSeconds, items, totalPrice } =
				this.parseOrderValue(value, score);

			const itemsCount = items.reduce((sum, item) => sum + item.quantity, 0);
			const categoryIds = [...new Set(items.map((item) => item.categoryId))];

			orders.push({
				orderId,
				currentTimeSeconds,
				itemsCount,
				totalPrice,
				categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
			});
		}

		return orders;
	}

	private isRuleActive(rule: Rule, orderTime: Date): boolean {
		const zonedDate = toZonedTime(orderTime, this.timeZone);

		const dayOfWeek = getDay(zonedDate);

		if (
			Array.isArray(rule.weekDays) &&
			rule.weekDays.length > 0 &&
			!rule.weekDays.includes(dayOfWeek)
		) {
			return false;
		}

		const orderMinutes = getHours(zonedDate) * 60 + getMinutes(zonedDate);

		if (rule.startTime) {
			const startTimeMinutes = timeStringToMinutes(rule.startTime);

			if (orderMinutes < startTimeMinutes) {
				return false;
			}
		}

		if (rule.endTime) {
			const endTimeMinutes = timeStringToMinutes(rule.endTime);

			if (orderMinutes > endTimeMinutes) {
				return false;
			}
		}

		return true;
	}

	private exceedsThreshold(
		ordersInWindow: RedisOrderValue[],
		rule: Rule,
	): boolean {
		const relevantOrders =
			rule.categoryIds.length > 0
				? ordersInWindow.filter((order) => {
						if (!order.categoryIds || order.categoryIds.length === 0) {
							return false;
						}
						return order.categoryIds.some((catId) =>
							rule.categoryIds.includes(catId),
						);
					})
				: ordersInWindow;

		const totalOrders = relevantOrders.length;
		const totalItems = relevantOrders.reduce(
			(sum, o) => sum + (o.itemsCount ?? 0),
			0,
		);
		const totalPriceSum = relevantOrders.reduce(
			(sum, o) => sum + (o.totalPrice ?? 0),
			0,
		);

		return (
			(rule.maxOrders != null && totalOrders >= rule.maxOrders) ||
			(rule.maxItems != null && totalItems >= rule.maxItems) ||
			(rule.maxAmountCents != null && totalPriceSum >= rule.maxAmountCents)
		);
	}
}
