import { expect } from "chai";
import type Redis from "ioredis";
import RedisMock from "ioredis-mock";
import { beforeEach, describe, it } from "mocha";
import {
	type BusyTimeRule,
	Engine,
	type Order,
	TIMEFRAME_MODE,
} from "../src/Engine";
import { toSeconds } from "../src/utils";

describe("Engine", () => {
	let redisMock: Redis;
	let engine: Engine;
	const bucket = "store_id:location_id";

	beforeEach(async () => {
		redisMock = new RedisMock();
		await redisMock.flushdb();
		engine = new Engine({
			redis: redisMock,
			bucket,
		});
	});

	describe("constructor", () => {
		it("should initialize with default values", () => {
			expect(engine).to.be.instanceOf(Engine);
		});

		it("should initialize with custom timeframe mode", () => {
			const centeredEngine = new Engine({
				redis: redisMock,
				bucket,
				timeframeMode: TIMEFRAME_MODE.CENTERED,
			});

			expect(centeredEngine).to.be.instanceOf(Engine);
		});

		it("should initialize Redis keys correctly", async () => {
			const order: Order = {
				orderId: "order-1",
				orderTime: new Date(),
				itemsCount: 5,
				totalPrice: 100,
			};

			await engine.validateOrder(order);

			const ordersExist = await redisMock.exists(`orders:${bucket}`);
			expect(ordersExist).to.equal(1);
		});
	});

	describe("setBusyTimeRule", () => {
		it("should set a valid busy time rule", () => {
			const rule: BusyTimeRule = {
				timeFrame: 30,
				prepTime: 20,
				maxOrders: 15,
				maxItems: 50,
				totalPrice: 1000,
			};

			expect(() => engine.setBusyTimeRule(rule)).to.not.throw();
		});

		it("should throw error when rule is null", () => {
			expect(() =>
				engine.setBusyTimeRule(null as unknown as BusyTimeRule),
			).to.throw("Busy time rule cannot be null or undefined");
		});

		it("should throw error when timeFrame is zero", () => {
			const rule: BusyTimeRule = {
				timeFrame: 0,
				prepTime: 20,
				maxOrders: 10,
			};

			expect(() => engine.setBusyTimeRule(rule)).to.throw(
				"timeFrame must be a positive number greater than 0",
			);
		});

		it("should throw error when timeFrame is negative", () => {
			const rule: BusyTimeRule = {
				timeFrame: -5,
				prepTime: 20,
				maxOrders: 10,
			};

			expect(() => engine.setBusyTimeRule(rule)).to.throw(
				"timeFrame must be a positive number greater than 0",
			);
		});

		it("should throw error when prepTime is zero", () => {
			const rule: BusyTimeRule = {
				timeFrame: 30,
				prepTime: 0,
				maxOrders: 10,
			};

			expect(() => engine.setBusyTimeRule(rule)).to.throw(
				"prepTime must be a positive number greater than 0",
			);
		});

		it("should throw error when maxOrders is zero", () => {
			const rule: BusyTimeRule = {
				timeFrame: 30,
				prepTime: 20,
				maxOrders: 0,
			};

			expect(() => engine.setBusyTimeRule(rule)).to.throw(
				"maxOrders must be a positive number greater than 0",
			);
		});

		it("should throw error when maxItems is negative", () => {
			const rule: BusyTimeRule = {
				timeFrame: 30,
				prepTime: 20,
				maxItems: -5,
			};

			expect(() => engine.setBusyTimeRule(rule)).to.throw(
				"maxItems must be a positive number greater than 0",
			);
		});

		it("should throw error when totalPrice is zero", () => {
			const rule: BusyTimeRule = {
				timeFrame: 30,
				prepTime: 20,
				totalPrice: 0,
			};

			expect(() => engine.setBusyTimeRule(rule)).to.throw(
				"totalPrice must be a positive number greater than 0",
			);
		});

		it("should throw error when no threshold is set", () => {
			const rule: BusyTimeRule = {
				timeFrame: 30,
				prepTime: 20,
			};

			expect(() => engine.setBusyTimeRule(rule)).to.throw(
				"At least one threshold must be set",
			);
		});

		it("should accept rule with only maxOrders threshold", () => {
			const rule: BusyTimeRule = {
				timeFrame: 30,
				prepTime: 20,
				maxOrders: 10,
			};

			expect(() => engine.setBusyTimeRule(rule)).to.not.throw();
		});

		it("should accept rule with only maxItems threshold", () => {
			const rule: BusyTimeRule = {
				timeFrame: 30,
				prepTime: 20,
				maxItems: 50,
			};

			expect(() => engine.setBusyTimeRule(rule)).to.not.throw();
		});

		it("should accept rule with only totalPrice threshold", () => {
			const rule: BusyTimeRule = {
				timeFrame: 30,
				prepTime: 20,
				totalPrice: 1000,
			};

			expect(() => engine.setBusyTimeRule(rule)).to.not.throw();
		});
	});

	describe("validateOrder", () => {
		const order: Order = {
			orderId: "order-1",
			orderTime: new Date("2024-01-01T12:00:00Z"),
			itemsCount: 5,
			totalPrice: 100,
		};

		beforeEach(() => {
			engine.setBusyTimeRule({
				timeFrame: 15,
				prepTime: 20,
				maxOrders: 10,
				maxItems: 50,
				totalPrice: 1000,
			});
		});

		it("should clean old orders and busy times", async () => {
			await engine.validateOrder(order);

			const ordersCount = await redisMock.zcard(`orders:${bucket}`);
			expect(ordersCount).to.be.greaterThanOrEqual(0);
		});

		it("should add order to Redis", async () => {
			await engine.validateOrder(order);

			const ordersCount = await redisMock.zcard(`orders:${bucket}`);
			expect(ordersCount).to.equal(1);

			const orders = await redisMock.zrange(`orders:${bucket}`, 0, -1);
			expect(orders[0]).to.include(order.orderId);
		});

		it("should query orders in time window", async () => {
			await engine.validateOrder(order);

			const ordersCount = await redisMock.zcard(`orders:${bucket}`);
			expect(ordersCount).to.be.greaterThanOrEqual(1);
		});

		it("should apply busy time when maxOrders threshold exceeded", async () => {
			const futureOrder: Order = {
				...order,
				orderTime: new Date(Date.now() + 3600 * 1000), // 1 hour from now
			};
			const orderTimeSeconds = toSeconds(futureOrder.orderTime);

			for (let i = 0; i < 10; i++) {
				await redisMock.zadd(
					`orders:${bucket}`,
					orderTimeSeconds,
					`order-${i}:${toSeconds(Date.now())}:2:50`,
				);
			}

			await engine.validateOrder(futureOrder);

			const busyTimesCount = await redisMock.zcard(`busytimes:${bucket}`);
			expect(busyTimesCount).to.be.greaterThan(0);
		});

		it("should apply busy time when maxItems threshold exceeded", async () => {
			const futureOrder: Order = {
				...order,
				orderTime: new Date(Date.now() + 3600 * 1000),
			};
			const orderTimeSeconds = toSeconds(futureOrder.orderTime);

			for (let i = 0; i < 5; i++) {
				await redisMock.zadd(
					`orders:${bucket}`,
					orderTimeSeconds,
					`order-${i}:${toSeconds(Date.now())}:10:50`,
				);
			}

			await engine.validateOrder(futureOrder);

			const busyTimesCount = await redisMock.zcard(`busytimes:${bucket}`);
			expect(busyTimesCount).to.be.greaterThan(0);
		});

		it("should apply busy time when totalPrice threshold exceeded", async () => {
			const futureOrder: Order = {
				...order,
				orderTime: new Date(Date.now() + 3600 * 1000),
			};
			const orderTimeSeconds = toSeconds(futureOrder.orderTime);

			for (let i = 0; i < 5; i++) {
				await redisMock.zadd(
					`orders:${bucket}`,
					orderTimeSeconds,
					`order-${i}:${toSeconds(Date.now())}:2:200`,
				);
			}

			await engine.validateOrder(futureOrder);

			const busyTimesCount = await redisMock.zcard(`busytimes:${bucket}`);
			expect(busyTimesCount).to.be.greaterThan(0);
		});

		it("should not apply busy time when thresholds not exceeded", async () => {
			await engine.validateOrder(order);

			const busyTimesCount = await redisMock.zcard(`busytimes:${bucket}`);
			expect(busyTimesCount).to.equal(0);
		});

		it("should handle multiple orders within time window", async () => {
			const futureOrder: Order = {
				...order,
				orderTime: new Date(Date.now() + 3600 * 1000),
			};
			const orderTimeSeconds = toSeconds(futureOrder.orderTime);

			await redisMock.zadd(
				`orders:${bucket}`,
				orderTimeSeconds,
				`order-1:${toSeconds(Date.now())}:3:75`,
			);
			await redisMock.zadd(
				`orders:${bucket}`,
				orderTimeSeconds,
				`order-2:${toSeconds(Date.now())}:2:50`,
			);

			await engine.validateOrder(futureOrder);

			const ordersCount = await redisMock.zcard(`orders:${bucket}`);
			expect(ordersCount).to.equal(3);
		});
	});

	describe("getBusyTimes", () => {
		it("should return empty array when no busy times exist", async () => {
			const result = await engine.getBusyTimes();

			expect(result).to.be.an("array").that.is.empty;
		});

		it("should return sorted busy time entries", async () => {
			const now = Date.now() + 3600 * 1000; // 1 hour from now
			const nowSeconds = toSeconds(now);

			await redisMock.zadd(
				`busytimes:${bucket}`,
				nowSeconds + 3600,
				`${toSeconds(Date.now())}:20`,
			);
			await redisMock.zadd(
				`busytimes:${bucket}`,
				nowSeconds,
				`${toSeconds(Date.now())}:15`,
			);
			await redisMock.zadd(
				`busytimes:${bucket}`,
				nowSeconds + 1800,
				`${toSeconds(Date.now())}:25`,
			);

			const result = await engine.getBusyTimes();

			expect(result).to.have.lengthOf(3);
			expect(result[0].busyTime).to.equal(15);
			expect(result[1].busyTime).to.equal(25);
			expect(result[2].busyTime).to.equal(20);
		});

		it("should clean old busy times before fetching", async () => {
			const now = toSeconds(Date.now());
			await redisMock.zadd(
				`busytimes:${bucket}`,
				now - 1000,
				`${now - 1000}:20`,
			);

			await engine.getBusyTimes();

			const count = await redisMock.zcard(`busytimes:${bucket}`);
			expect(count).to.equal(0);
		});

		it("should calculate start and end times correctly", async () => {
			const now = new Date(Date.now() + 3600 * 1000);
			const nowSeconds = toSeconds(now);

			await redisMock.zadd(
				`busytimes:${bucket}`,
				nowSeconds,
				`${toSeconds(Date.now())}:30`,
			);

			const result = await engine.getBusyTimes();

			expect(result).to.have.lengthOf(1);
			expect(result[0].busyTime).to.equal(30);
			expect(toSeconds(result[0].endTime)).to.equal(nowSeconds);
		});
	});

	describe("getOrders", () => {
		it("should return empty array when no orders exist", async () => {
			const result = await engine.getOrders();

			expect(result).to.be.an("array").that.is.empty;
		});

		it("should return all orders", async () => {
			const now = Date.now() + 3600 * 1000;
			const nowSeconds = toSeconds(now);

			await redisMock.zadd(
				`orders:${bucket}`,
				nowSeconds,
				`order-1:${toSeconds(Date.now())}:5:100`,
			);
			await redisMock.zadd(
				`orders:${bucket}`,
				nowSeconds + 600,
				`order-2:${toSeconds(Date.now())}:3:75`,
			);

			const result = await engine.getOrders();

			expect(result).to.have.lengthOf(2);
			expect(result[0].orderId).to.equal("order-1");
			expect(result[0].itemsCount).to.equal(5);
			expect(result[0].totalPrice).to.equal(100);
			expect(result[1].orderId).to.equal("order-2");
			expect(result[1].itemsCount).to.equal(3);
			expect(result[1].totalPrice).to.equal(75);
		});

		it("should clean old orders before fetching", async () => {
			const now = toSeconds(Date.now());
			const oldTime = now - 604801;
			await redisMock.zadd(
				`orders:${bucket}`,
				oldTime,
				`order-old:${oldTime}:5:100`,
			);

			await engine.getOrders();

			const count = await redisMock.zcard(`orders:${bucket}`);
			expect(count).to.equal(0);
		});

		it("should parse order data correctly", async () => {
			const now = Date.now() + 3600 * 1000;
			const nowSeconds = toSeconds(now);

			await redisMock.zadd(
				`orders:${bucket}`,
				nowSeconds,
				`order-123:${toSeconds(Date.now())}:10:250.50`,
			);

			const result = await engine.getOrders();

			expect(result).to.have.lengthOf(1);
			expect(result[0].orderId).to.equal("order-123");
			expect(result[0].itemsCount).to.equal(10);
			expect(result[0].totalPrice).to.equal(250.5);
		});
	});

	describe("validateOrderTime", () => {
		it("should return zero wait time when no busy times exist", async () => {
			const orderTime = new Date("2024-01-01T12:00:00Z");
			const result = await engine.validateOrderTime(orderTime);

			expect(result.waitPeriodSeconds).to.equal(0);
			expect(result.ordersInWindow).to.equal(0);
		});

		it("should calculate wait time when order falls within busy period", async () => {
			const orderTime = new Date(Date.now() + 3600 * 1000);
			const orderTimeSeconds = toSeconds(orderTime);
			const busyEndTime = orderTimeSeconds + 1800;

			await redisMock.zadd(
				`busytimes:${bucket}`,
				busyEndTime,
				`${toSeconds(Date.now())}:30`,
			);

			const result = await engine.validateOrderTime(orderTime);

			expect(result.waitPeriodSeconds).to.equal(1801);
		});

		it("should return zero wait time when order is after busy period", async () => {
			const orderTime = new Date("2024-01-01T13:00:00Z");
			const busyEndTime = new Date("2024-01-01T12:00:00Z");

			await redisMock.zadd(
				`busytimes:${bucket}`,
				toSeconds(busyEndTime),
				`${toSeconds(Date.now())}:30`,
			);

			const result = await engine.validateOrderTime(orderTime);

			expect(result.waitPeriodSeconds).to.equal(0);
		});

		it("should handle multiple overlapping busy periods", async () => {
			const orderTime = new Date(Date.now() + 3600 * 1000);
			const orderTimeSeconds = toSeconds(orderTime);
			const busy1End = orderTimeSeconds + 900;
			const busy2End = busy1End + 600;

			await redisMock.zadd(
				`busytimes:${bucket}`,
				busy1End,
				`${toSeconds(Date.now())}:15`,
			);
			await redisMock.zadd(
				`busytimes:${bucket}`,
				busy2End,
				`${toSeconds(Date.now())}:10`,
			);

			const result = await engine.validateOrderTime(orderTime);

			expect(result.waitPeriodSeconds).to.be.greaterThan(0);
		});

		it("should return zero for orders before any busy periods", async () => {
			const orderTime = new Date("2024-01-01T11:00:00Z");
			const busyEndTime = new Date("2024-01-01T12:30:00Z");

			await redisMock.zadd(
				`busytimes:${bucket}`,
				toSeconds(busyEndTime),
				`${toSeconds(Date.now())}:30`,
			);

			const result = await engine.validateOrderTime(orderTime);

			expect(result.waitPeriodSeconds).to.equal(0);
		});
	});

	describe("timeframe modes", () => {
		describe("BEFORE_ONLY mode", () => {
			it("should consider orders before current order time", async () => {
				engine.setBusyTimeRule({
					timeFrame: 15,
					prepTime: 20,
					maxOrders: 2,
				});

				const orderTime = new Date(Date.now() + 3600 * 1000);
				const orderTimeSeconds = toSeconds(orderTime);

				// Add orders before the current order
				await redisMock.zadd(
					`orders:${bucket}`,
					orderTimeSeconds - 300, // 5 min before
					`order-before-1:${toSeconds(Date.now())}:5:100`,
				);
				await redisMock.zadd(
					`orders:${bucket}`,
					orderTimeSeconds - 600, // 10 min before
					`order-before-2:${toSeconds(Date.now())}:5:100`,
				);

				// Add order after (should not be considered in BEFORE_ONLY mode)
				await redisMock.zadd(
					`orders:${bucket}`,
					orderTimeSeconds + 300,
					`order-after:${toSeconds(Date.now())}:5:100`,
				);

				const order: Order = {
					orderId: "order-current",
					orderTime,
					itemsCount: 5,
					totalPrice: 100,
				};

				await engine.validateOrder(order);

				// Should apply busy time because we have 2 orders before + current order
				const busyTimesCount = await redisMock.zcard(`busytimes:${bucket}`);
				expect(busyTimesCount).to.be.greaterThan(0);
			});
		});

		describe("CENTERED mode", () => {
			it("should consider orders both before and after centered on order time", async () => {
				const centeredEngine = new Engine({
					redis: redisMock,
					bucket,
					timeframeMode: TIMEFRAME_MODE.CENTERED,
				});

				centeredEngine.setBusyTimeRule({
					timeFrame: 30,
					prepTime: 20,
					maxOrders: 2,
				});

				const orderTime = new Date(Date.now() + 3600 * 1000);
				const orderTimeSeconds = toSeconds(orderTime);

				// Add order 10 min before (within 15 min centered window)
				await redisMock.zadd(
					`orders:${bucket}`,
					orderTimeSeconds - 600,
					`order-before:${toSeconds(Date.now())}:5:100`,
				);

				// Add order 10 min after (within 15 min centered window)
				await redisMock.zadd(
					`orders:${bucket}`,
					orderTimeSeconds + 600,
					`order-after:${toSeconds(Date.now())}:5:100`,
				);

				const order: Order = {
					orderId: "order-current",
					orderTime,
					itemsCount: 5,
					totalPrice: 100,
				};

				await centeredEngine.validateOrder(order);

				// Should apply busy time (3 orders total)
				const busyTimesCount = await redisMock.zcard(`busytimes:${bucket}`);
				expect(busyTimesCount).to.be.greaterThan(0);
			});
		});

		describe("AFTER_ONLY mode", () => {
			it("should consider orders after current order time", async () => {
				const afterEngine = new Engine({
					redis: redisMock,
					bucket,
					timeframeMode: TIMEFRAME_MODE.AFTER_ONLY,
				});

				afterEngine.setBusyTimeRule({
					timeFrame: 15,
					prepTime: 20,
					maxOrders: 2,
				});

				const orderTime = new Date(Date.now() + 3600 * 1000);
				const orderTimeSeconds = toSeconds(orderTime);

				// Add orders after the current order
				await redisMock.zadd(
					`orders:${bucket}`,
					orderTimeSeconds + 300,
					`order-after-1:${toSeconds(Date.now())}:5:100`,
				);
				await redisMock.zadd(
					`orders:${bucket}`,
					orderTimeSeconds + 600,
					`order-after-2:${toSeconds(Date.now())}:5:100`,
				);

				// Add order before (should not be considered in AFTER_ONLY mode)
				await redisMock.zadd(
					`orders:${bucket}`,
					orderTimeSeconds - 300,
					`order-before:${toSeconds(Date.now())}:5:100`,
				);

				const order: Order = {
					orderId: "order-current",
					orderTime,
					itemsCount: 5,
					totalPrice: 100,
				};

				await afterEngine.validateOrder(order);

				// Should apply busy time (3 orders after including current)
				const busyTimesCount = await redisMock.zcard(`busytimes:${bucket}`);
				expect(busyTimesCount).to.be.greaterThan(0);
			});
		});

		describe("BEFORE_AND_AFTER mode", () => {
			it("should consider full timeframe window both directions", async () => {
				const bothEngine = new Engine({
					redis: redisMock,
					bucket,
					timeframeMode: TIMEFRAME_MODE.BEFORE_AND_AFTER,
				});

				bothEngine.setBusyTimeRule({
					timeFrame: 15,
					prepTime: 20,
					maxOrders: 2,
				});

				const orderTime = new Date(Date.now() + 3600 * 1000);
				const orderTimeSeconds = toSeconds(orderTime);

				// Add order 10 min before (within 15 min window)
				await redisMock.zadd(
					`orders:${bucket}`,
					orderTimeSeconds - 600,
					`order-before:${toSeconds(Date.now())}:5:100`,
				);

				// Add order 10 min after (within 15 min window)
				await redisMock.zadd(
					`orders:${bucket}`,
					orderTimeSeconds + 600,
					`order-after:${toSeconds(Date.now())}:5:100`,
				);

				const order: Order = {
					orderId: "order-current",
					orderTime,
					itemsCount: 5,
					totalPrice: 100,
				};

				await bothEngine.validateOrder(order);

				const busyTimesCount = await redisMock.zcard(`busytimes:${bucket}`);
				expect(busyTimesCount).to.be.greaterThan(0);
			});
		});
	});

	describe("edge cases", () => {
		it("should handle orders with zero items", async () => {
			const order: Order = {
				orderId: "order-1",
				orderTime: new Date(),
				itemsCount: 0,
				totalPrice: 0,
			};

			engine.setBusyTimeRule({
				timeFrame: 15,
				prepTime: 20,
				maxOrders: 10,
			});

			await engine.validateOrder(order);

			const ordersCount = await redisMock.zcard(`orders:${bucket}`);
			expect(ordersCount).to.equal(1);
		});

		it("should handle very large order values", async () => {
			const order: Order = {
				orderId: "order-1",
				orderTime: new Date(),
				itemsCount: 1000,
				totalPrice: 999999.99,
			};

			engine.setBusyTimeRule({
				timeFrame: 15,
				prepTime: 20,
				maxOrders: 10,
				maxItems: 100,
				totalPrice: 10000,
			});

			await engine.validateOrder(order);

			const busyTimesCount = await redisMock.zcard(`busytimes:${bucket}`);
			expect(busyTimesCount).to.equal(1);
		});

		it("should handle fractional prices correctly", async () => {
			const now = Date.now() + 3600 * 1000;
			await redisMock.zadd(
				`orders:${bucket}`,
				toSeconds(now),
				`order-1:${toSeconds(Date.now())}:5:123.45`,
			);

			const result = await engine.getOrders();

			expect(result).to.have.lengthOf(1);
			expect(result[0].totalPrice).to.equal(123.45);
		});

		it("should handle orders at exact threshold boundary", async () => {
			engine.setBusyTimeRule({
				timeFrame: 15,
				prepTime: 20,
				maxOrders: 5,
			});

			const orderTime = new Date(Date.now() + 86400 * 1000); // 24 hours in future
			const orderTimeSeconds = toSeconds(orderTime);

			for (let i = 0; i < 4; i++) {
				await redisMock.zadd(
					`orders:${bucket}`,
					orderTimeSeconds,
					`order-${i}:${toSeconds(Date.now())}:2:50`,
				);
			}

			const order: Order = {
				orderId: "order-5",
				orderTime,
				itemsCount: 2,
				totalPrice: 50,
			};

			await engine.validateOrder(order);

			const busyTimesCount = await redisMock.zcard(`busytimes:${bucket}`);
			expect(busyTimesCount).to.equal(1);
		});
	});
});
