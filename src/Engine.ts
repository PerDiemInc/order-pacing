import type Redis from "ioredis";
import type { Logger } from "./logger";
import { noopLogger } from "./logger";
import { minutesToSeconds, scoreToDate, toSeconds } from "./utils";

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

export interface BusyTimeRule {
	timeFrame: number;
	prepTime: number;
	maxOrders?: number;
	maxItems?: number;
	totalPrice?: number;
}

export interface Order {
	orderId: string;
	orderTime: Date;
	itemsCount?: number;
	totalPrice?: number;
	source?: OrderSource;
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

export interface OrderData {
	orderId: string;
	orderTime: Date;
	currentTimeSeconds: number;
	itemsCount?: number;
	totalPrice?: number;
	source?: OrderSource;
}

export interface BusyTimeData {
	orderTimeSeconds: number;
	currentTimeSeconds: number;
	prepTime: number;
}

export interface RedisOrderValue {
	orderId: string;
	currentTimeSeconds: number;
	itemsCount?: number;
	totalPrice?: number;
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
	 * Redis key for orders
	 */
	private readonly ordersKey: string;

	/**
	 * Redis key for busy times
	 */
	private readonly busyTimesKey: string;

	/**
	 * Default busy time rule
	 */
	private busyTimeRule: BusyTimeRule = {
		timeFrame: 15,
		prepTime: 15,
		maxOrders: 10,
		maxItems: 10,
		totalPrice: undefined,
	};

	constructor({
		redis,
		logger = noopLogger,
		bucket,
		timeframeMode = TIMEFRAME_MODE.BEFORE_ONLY,
	}: EngineParams) {
		this.redis = redis;
		this.logger = logger;
		this.bucket = bucket;
		this.timeframeMode = timeframeMode;
		this.ordersKey = `orders:${this.bucket}`;
		this.busyTimesKey = `busytimes:${this.bucket}`;
	}

	public setBusyTimeRule(busyTimeRule: BusyTimeRule): void {
		if (!busyTimeRule) {
			throw new Error("Busy time rule cannot be null or undefined");
		}

		if (
			typeof busyTimeRule.timeFrame !== "number" ||
			busyTimeRule.timeFrame <= 0
		) {
			throw new Error(
				"timeFrame must be a positive number greater than 0 (in minutes)",
			);
		}

		if (
			typeof busyTimeRule.prepTime !== "number" ||
			busyTimeRule.prepTime <= 0
		) {
			throw new Error(
				"prepTime must be a positive number greater than 0 (in minutes)",
			);
		}

		if (
			busyTimeRule.maxOrders !== undefined &&
			(typeof busyTimeRule.maxOrders !== "number" ||
				busyTimeRule.maxOrders <= 0)
		) {
			throw new Error("maxOrders must be a positive number greater than 0");
		}

		if (
			busyTimeRule.maxItems !== undefined &&
			(typeof busyTimeRule.maxItems !== "number" || busyTimeRule.maxItems <= 0)
		) {
			throw new Error("maxItems must be a positive number greater than 0");
		}

		if (
			busyTimeRule.totalPrice !== undefined &&
			(typeof busyTimeRule.totalPrice !== "number" ||
				busyTimeRule.totalPrice <= 0)
		) {
			throw new Error("totalPrice must be a positive number greater than 0");
		}

		if (
			busyTimeRule.maxOrders === undefined &&
			busyTimeRule.maxItems === undefined &&
			busyTimeRule.totalPrice === undefined
		) {
			throw new Error(
				"At least one threshold must be set (maxOrders, maxItems, or totalPrice)",
			);
		}

		this.busyTimeRule = busyTimeRule;
	}

	public async validateOrder(order: Order): Promise<void> {
		if (!this.busyTimeRule) {
			this.logger.warn("Busy time rule not set, using defaults");
		}

		const orderTimeSeconds = toSeconds(order.orderTime);
		const currentTimeSeconds = toSeconds(Date.now());

		await this.cleanOldOrders(currentTimeSeconds);
		await this.cleanOldBusyTimes(currentTimeSeconds);

		const orderData: OrderData = { ...order, currentTimeSeconds };
		await this.addOrder(orderData);

		const timeWindow = this.calculateTimeWindow({
			orderTimeSeconds,
			timeFrameSeconds: minutesToSeconds(this.busyTimeRule.timeFrame),
		});

		const ordersInWindow = await this.getOrdersInWindow(timeWindow);

		if (this.shouldApplyBusyTime(ordersInWindow)) {
			const busyTimeData: BusyTimeData = {
				orderTimeSeconds,
				currentTimeSeconds,
				prepTime: this.busyTimeRule.prepTime,
			};

			await this.addBusyTime(busyTimeData);
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
			const { orderId, orderTime, itemsCount, totalPrice } =
				this.parseOrderValue(value, score);

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

	private getOrderValue(orderData: OrderData): string {
		const { orderId, currentTimeSeconds, itemsCount, totalPrice, source } =
			orderData;

		return `${orderId}:${currentTimeSeconds}:${itemsCount ?? 0}:${totalPrice ?? 0}:${source || ORDER_SOURCE.PERDIEM}`;
	}

	private getBusyTimeValue(busyTimeData: BusyTimeData): string {
		return `${busyTimeData.currentTimeSeconds}:${busyTimeData.prepTime}`;
	}

	private parseOrderValue(value: string, score: number) {
		const [
			orderId,
			currentTimeSecondsStr,
			itemsCountStr,
			totalPriceStr,
			source,
		] = value.split(":");

		const itemsCount = parseInt(itemsCountStr, 10);
		const totalPrice = parseFloat(totalPriceStr);

		return {
			orderId,
			orderTime: scoreToDate(score),
			currentTimeSeconds: parseInt(currentTimeSecondsStr, 10),
			itemsCount: Number.isNaN(itemsCount) ? undefined : itemsCount,
			totalPrice: Number.isNaN(totalPrice) ? undefined : totalPrice,
			source: (source || ORDER_SOURCE.PERDIEM) as OrderSource,
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
			const { orderId, currentTimeSeconds, itemsCount, totalPrice } =
				this.parseOrderValue(value, score);

			orders.push({
				orderId,
				currentTimeSeconds,
				itemsCount,
				totalPrice,
			});
		}

		return orders;
	}

	private shouldApplyBusyTime(ordersInWindow: RedisOrderValue[]): boolean {
		const totalOrders = ordersInWindow.length;
		const totalItems = ordersInWindow.reduce(
			(sum, o) => sum + (o.itemsCount ?? 0),
			0,
		);
		const totalPriceSum = ordersInWindow.reduce(
			(sum, o) => sum + (o.totalPrice ?? 0),
			0,
		);

		return (
			(this.busyTimeRule.maxOrders != null &&
				totalOrders >= this.busyTimeRule.maxOrders) ||
			(this.busyTimeRule.maxItems != null &&
				totalItems >= this.busyTimeRule.maxItems) ||
			(this.busyTimeRule.totalPrice != null &&
				totalPriceSum >= this.busyTimeRule.totalPrice)
		);
	}
}
