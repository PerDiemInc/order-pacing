import { randomUUID } from "node:crypto";
import { expect } from "chai";
import type Redis from "ioredis";
import RedisMock from "ioredis-mock";
import { encodeBusyTime } from "../src/encoder";
import { Engine } from "../src/engine";
import type { BusyTime, InputOrder } from "../src/engine/types";
import { OrderSource, TimeframeMode } from "../src/engine/types";
import type { Rule } from "../src/rules/types";
import { toSeconds } from "../src/utils";

const MINUTE_MS = 60 * 1000;

function baseRule(overrides: Partial<Rule> = {}): Rule {
	return {
		ruleId: "rule-1",
		timeFrameMinutes: 30,
		busyTimeMinutes: 15,
		categoryIds: [],
		weekDays: [],
		maxOrders: 3,
		...overrides,
	};
}

function createEngine(rules: Rule[], opts: { timeframeMode?: TimeframeMode; timeZone?: string } = {}) {
	const bucket = `test:${randomUUID()}`;
	const redis = new RedisMock() as unknown as Redis;
	const engine = new Engine({ bucket, redis, rules, ...opts });

	return { engine, redis, bucket };
}

function makeOrder(overrides: Partial<InputOrder> = {}): InputOrder {
	return {
		orderId: randomUUID(),
		orderTime: new Date(),
		totalAmountCents: 1000,
		source: OrderSource.PERDIEM,
		tags: ["pickup"],
		items: [{ itemId: "item-1", quantity: 1, totalAmountCents: 1000, categoryId: null }],
		...overrides,
	};
}

async function seedBusyTime(
	redis: Redis,
	bucket: string,
	startTime: Date,
	endTime: Date,
	totalOrders = 5,
	scope: string[] = [],
): Promise<void> {
	const busyTime: BusyTime = {
		busyTimeId: randomUUID(),
		ruleId: "rule-1",
		startTime,
		endTime,
		orderTimeSeconds: toSeconds(endTime),
		currentTimeSeconds: toSeconds(Date.now()),
		busyTimeSeconds: toSeconds(endTime) - toSeconds(startTime),
		scope,
		busyTimeContext: { totalAmountCents: 0, totalItems: 0, totalOrders, categoryIds: [] },
		threshold: { type: "orders", value: totalOrders, limit: 3, categoryIds: [] },
	};

	await redis.zadd(`busytimes:${bucket}`, toSeconds(endTime), encodeBusyTime(busyTime));
}

describe("Engine.add", () => {
	it("creates a busy time when maxOrders is reached within the window", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: 3 })]);
		const now = Date.now();

		await engine.add(makeOrder({ orderTime: new Date(now - 10 * MINUTE_MS) }));
		await engine.add(makeOrder({ orderTime: new Date(now - 5 * MINUTE_MS) }));

		expect(await engine.getBusyTimes()).to.have.length(0);

		await engine.add(makeOrder({ orderTime: new Date(now) }));

		const busyTimes = await engine.getBusyTimes();

		expect(busyTimes).to.have.length(1);
		expect(busyTimes[0].ruleId).to.equal("rule-1");
		expect(busyTimes[0].threshold).to.deep.include({ type: "orders", value: 3, limit: 3 });
		expect(busyTimes[0].busyTimeContext.totalOrders).to.equal(3);
		expect(toSeconds(busyTimes[0].endTime) - toSeconds(busyTimes[0].startTime)).to.equal(15 * 60);
	});

	it("does not count orders outside the time window", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: 2, timeFrameMinutes: 15 })]);
		const now = Date.now();

		await engine.add(makeOrder({ orderTime: new Date(now - 60 * MINUTE_MS) }));
		await engine.add(makeOrder({ orderTime: new Date(now) }));

		expect(await engine.getBusyTimes()).to.have.length(0);
	});

	it("ignores non-PERDIEM orders for both triggering and counting", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: 2 })]);
		const now = Date.now();

		await engine.add(makeOrder({ orderTime: new Date(now - 6 * MINUTE_MS), source: OrderSource.OTHER }));
		await engine.add(makeOrder({ orderTime: new Date(now - 4 * MINUTE_MS), source: OrderSource.OTHER }));
		await engine.add(makeOrder({ orderTime: new Date(now - 2 * MINUTE_MS) }));

		expect(await engine.getBusyTimes()).to.have.length(0);

		await engine.add(makeOrder({ orderTime: new Date(now) }));

		expect(await engine.getBusyTimes()).to.have.length(1);
	});

	it("triggers on maxItems using item quantities", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: undefined, maxItems: 5 })]);
		const now = Date.now();

		await engine.add(
			makeOrder({
				orderTime: new Date(now - MINUTE_MS),
				items: [{ itemId: "a", quantity: 3, totalAmountCents: 300, categoryId: null }],
			}),
		);

		expect(await engine.getBusyTimes()).to.have.length(0);

		await engine.add(
			makeOrder({
				orderTime: new Date(now),
				items: [{ itemId: "b", quantity: 2, totalAmountCents: 200, categoryId: null }],
			}),
		);

		const busyTimes = await engine.getBusyTimes();

		expect(busyTimes).to.have.length(1);
		expect(busyTimes[0].threshold).to.deep.include({ type: "items", value: 5, limit: 5 });
	});

	it("triggers on maxAmountCents using order totals", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: undefined, maxAmountCents: 5000 })]);
		const now = Date.now();

		await engine.add(makeOrder({ orderTime: new Date(now - MINUTE_MS), totalAmountCents: 3000 }));
		await engine.add(makeOrder({ orderTime: new Date(now), totalAmountCents: 2000 }));

		const busyTimes = await engine.getBusyTimes();

		expect(busyTimes).to.have.length(1);
		expect(busyTimes[0].threshold).to.deep.include({ type: "amount", value: 5000, limit: 5000 });
	});

	it("only counts orders with matching items when categoryIds is set", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: 2, categoryIds: ["cat-1"] })]);
		const now = Date.now();

		await engine.add(
			makeOrder({
				orderTime: new Date(now - 4 * MINUTE_MS),
				items: [{ itemId: "a", quantity: 1, totalAmountCents: 100, categoryId: "cat-2" }],
			}),
		);
		await engine.add(
			makeOrder({
				orderTime: new Date(now - 2 * MINUTE_MS),
				items: [{ itemId: "b", quantity: 1, totalAmountCents: 100, categoryId: "cat-1" }],
			}),
		);

		expect(await engine.getBusyTimes()).to.have.length(0);

		await engine.add(
			makeOrder({
				orderTime: new Date(now),
				items: [{ itemId: "c", quantity: 1, totalAmountCents: 100, categoryId: "cat-1" }],
			}),
		);

		const busyTimes = await engine.getBusyTimes();

		expect(busyTimes).to.have.length(1);
		expect(busyTimes[0].threshold.categoryIds).to.deep.equal(["cat-1"]);
	});

	it("writes one busy time per matching rule", async () => {
		const { engine } = createEngine([
			baseRule({ ruleId: "rule-1", maxOrders: 1 }),
			baseRule({ ruleId: "rule-2", maxOrders: 1 }),
		]);

		await engine.add(makeOrder());

		const busyTimes = await engine.getBusyTimes();

		expect(busyTimes).to.have.length(2);
		expect(busyTimes.map((busyTime) => busyTime.ruleId).sort()).to.deep.equal(["rule-1", "rule-2"]);
	});

	it("counts future orders with AFTER_ONLY but not with BEFORE_ONLY", async () => {
		const now = Date.now();
		const futureOrders = [
			makeOrder({ orderTime: new Date(now + 10 * MINUTE_MS) }),
			makeOrder({ orderTime: new Date(now + 5 * MINUTE_MS) }),
		];

		const before = createEngine([baseRule({ maxOrders: 3 })], { timeframeMode: TimeframeMode.BEFORE_ONLY });
		const after = createEngine([baseRule({ maxOrders: 3 })], { timeframeMode: TimeframeMode.AFTER_ONLY });

		for (const target of [before, after]) {
			for (const futureOrder of futureOrders) {
				await target.engine.add(makeOrder({ ...futureOrder }));
			}

			await target.engine.add(makeOrder({ orderTime: new Date(now) }));
		}

		expect(await before.engine.getBusyTimes()).to.have.length(0);
		expect(await after.engine.getBusyTimes()).to.have.length(1);
	});

	it("counts orders on both sides of the anchor with CENTERED and BEFORE_AND_AFTER", async () => {
		const now = Date.now();

		for (const timeframeMode of [TimeframeMode.CENTERED, TimeframeMode.BEFORE_AND_AFTER]) {
			const { engine } = createEngine([baseRule({ maxOrders: 3 })], { timeframeMode });

			await engine.add(makeOrder({ orderTime: new Date(now - 10 * MINUTE_MS) }));
			await engine.add(makeOrder({ orderTime: new Date(now + 10 * MINUTE_MS) }));
			await engine.add(makeOrder({ orderTime: new Date(now) }));

			expect(await engine.getBusyTimes(), timeframeMode).to.have.length(1);
		}
	});

	it("counts catering deliveries toward the plain delivery cap", async () => {
		const { engine } = createEngine([baseRule({ ruleId: "delivery-cap", tags: ["delivery"], maxOrders: 2 })]);
		const now = Date.now();

		await engine.add(
			makeOrder({
				orderTime: new Date(now - MINUTE_MS),
				tags: ["delivery", "catering"],
			}),
		);
		await engine.add(makeOrder({ orderTime: new Date(now), tags: ["delivery"] }));

		const busyTimes = await engine.getBusyTimes();

		expect(busyTimes).to.have.length(1);
		expect(busyTimes[0].ruleId).to.equal("delivery-cap");
	});

	it("stores orders of both sources for reads", async () => {
		const { engine } = createEngine([baseRule()]);

		await engine.add(makeOrder({ source: OrderSource.PERDIEM }));
		await engine.add(makeOrder({ source: OrderSource.OTHER }));

		const orders = await engine.getOrders();

		expect(orders).to.have.length(2);
	});
});

describe("Engine constructor", () => {
	it("throws when rules is not an array", () => {
		const redis = new RedisMock() as unknown as Redis;
		const rules = baseRule() as unknown as Rule[];

		expect(() => new Engine({ bucket: "b", redis, rules })).to.throw(TypeError, /array/);
	});

	it("identifies the offending rule in validation errors", () => {
		const redis = new RedisMock() as unknown as Redis;
		const rules = [baseRule(), baseRule({ ruleId: "bad-rule", busyTimeMinutes: 2 })];

		expect(() => new Engine({ bucket: "b", redis, rules })).to.throw(/bad-rule/);
	});
});

describe("Engine.add input handling", () => {
	it("throws on an invalid orderTime", async () => {
		const { engine } = createEngine([baseRule()]);
		let thrown: unknown;

		try {
			await engine.add(makeOrder({ orderTime: new Date("garbage") }));
		} catch (error) {
			thrown = error;
		}

		expect(thrown).to.be.instanceOf(TypeError);
	});

	it("throws on an empty orderId", async () => {
		const { engine } = createEngine([baseRule()]);
		let thrown: unknown;

		try {
			await engine.add(makeOrder({ orderId: "" }));
		} catch (error) {
			thrown = error;
		}

		expect(thrown).to.be.instanceOf(TypeError);
	});

	it("throws on invalid tags", async () => {
		const { engine } = createEngine([baseRule()]);
		let thrown: unknown;

		try {
			await engine.add(makeOrder({ tags: [""] }));
		} catch (error) {
			thrown = error;
		}

		expect(thrown).to.be.instanceOf(TypeError);
	});

	it("does not mutate the caller's order object", async () => {
		const { engine } = createEngine([baseRule()]);
		const inputOrder = makeOrder();

		await engine.add(inputOrder);

		expect(inputOrder).to.not.have.property("orderTimeSeconds");
		expect(inputOrder).to.not.have.property("currentTimeSeconds");
	});

	it("prunes orders past the retention window on add", async () => {
		const { engine } = createEngine([baseRule()]);
		const now = Date.now();

		await engine.add(makeOrder({ orderTime: new Date(now - 8 * 24 * 60 * MINUTE_MS) }));
		await engine.add(makeOrder({ orderTime: new Date(now) }));

		expect(await engine.getOrders()).to.have.length(1);
	});
});

describe("Engine fulfillment and catering rules", () => {
	it("counts only matching fulfillment orders toward a scoped rule", async () => {
		const { engine } = createEngine([baseRule({ ruleId: "delivery-cap", tags: ["delivery"], maxOrders: 2 })]);
		const now = Date.now();

		await engine.add(makeOrder({ orderTime: new Date(now - 4 * MINUTE_MS) }));
		await engine.add(makeOrder({ orderTime: new Date(now - 3 * MINUTE_MS) }));
		await engine.add(makeOrder({ orderTime: new Date(now - 2 * MINUTE_MS), tags: ["delivery"] }));

		expect(await engine.getBusyTimes()).to.have.length(0);

		await engine.add(makeOrder({ orderTime: new Date(now), tags: ["delivery"] }));

		expect(await engine.getBusyTimes()).to.have.length(1);
	});

	it("does not re-trip a scoped rule from non-matching orders", async () => {
		const { engine } = createEngine([baseRule({ ruleId: "delivery-cap", tags: ["delivery"], maxOrders: 2 })]);
		const now = Date.now();

		await engine.add(makeOrder({ orderTime: new Date(now - 2 * MINUTE_MS), tags: ["delivery"] }));
		await engine.add(makeOrder({ orderTime: new Date(now - MINUTE_MS), tags: ["delivery"] }));

		expect(await engine.getBusyTimes()).to.have.length(1);

		await engine.add(makeOrder({ orderTime: new Date(now) }));
		await engine.add(makeOrder({ orderTime: new Date(now) }));

		expect(await engine.getBusyTimes()).to.have.length(1);
	});

	it("stamps the tripping rule's filters on the busy time scope", async () => {
		const { engine } = createEngine([baseRule({ tags: ["delivery", "catering"], maxOrders: 1 })]);

		await engine.add(makeOrder({ tags: ["delivery", "catering"] }));

		const busyTimes = await engine.getBusyTimes();

		expect(busyTimes).to.have.length(1);
		expect(busyTimes[0].scope).to.deep.equal(["delivery", "catering"]);
	});

	it("counts catering and fulfillment filters together", async () => {
		const { engine } = createEngine([baseRule({ tags: ["delivery", "catering"], maxOrders: 2 })]);
		const now = Date.now();

		await engine.add(makeOrder({ orderTime: new Date(now - 2 * MINUTE_MS), tags: ["delivery"] }));
		await engine.add(makeOrder({ orderTime: new Date(now - MINUTE_MS), tags: ["delivery", "catering"] }));

		expect(await engine.getBusyTimes()).to.have.length(0);

		await engine.add(makeOrder({ orderTime: new Date(now), tags: ["delivery", "catering"] }));

		expect(await engine.getBusyTimes()).to.have.length(1);
	});
});

describe("Engine busy time anchoring", () => {
	it("ends the busy window at the scheduled time for far-future orders", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: 1 })]);
		const orderTime = new Date(Date.now() + 60 * MINUTE_MS);

		await engine.add(makeOrder({ orderTime }));

		const [busyTime] = await engine.getBusyTimes();

		expect(toSeconds(busyTime.endTime)).to.equal(toSeconds(orderTime));
		expect(toSeconds(busyTime.endTime) - toSeconds(busyTime.startTime)).to.equal(15 * 60);
	});

	it("ends the busy window busyTimeMinutes from now for near-term orders", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: 1 })]);
		const now = Date.now();

		await engine.add(makeOrder({ orderTime: new Date(now) }));

		const [busyTime] = await engine.getBusyTimes();

		expect(toSeconds(busyTime.endTime)).to.be.closeTo(toSeconds(now) + 15 * 60, 2);
		expect(toSeconds(busyTime.endTime) - toSeconds(busyTime.startTime)).to.equal(15 * 60);
	});
});

describe("Engine.validateOrderTime", () => {
	it("throws on an invalid orderTime", async () => {
		const { engine } = createEngine([baseRule()]);
		let thrown: unknown;

		try {
			await engine.validateOrderTime(new Date("garbage"), ["pickup"]);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).to.be.instanceOf(TypeError);
	});

	it("returns zero wait when there are no busy times", async () => {
		const { engine } = createEngine([baseRule()]);

		const result = await engine.validateOrderTime(new Date(), ["pickup"]);

		expect(result).to.deep.equal({ waitPeriodSeconds: 0, ordersInWindow: 0 });
	});

	it("returns the wait until one second past the containing window's end", async () => {
		const { engine, redis, bucket } = createEngine([baseRule()]);
		const now = new Date();
		const end = new Date(now.getTime() + 10 * MINUTE_MS);

		await seedBusyTime(redis, bucket, new Date(now.getTime() - 5 * MINUTE_MS), end, 7);

		const result = await engine.validateOrderTime(now, ["pickup"]);

		expect(result.waitPeriodSeconds).to.equal(toSeconds(end) + 1 - toSeconds(now));
		expect(result.ordersInWindow).to.equal(7);
	});

	it("chains consecutive windows and stops at the first gap", async () => {
		const { engine, redis, bucket } = createEngine([baseRule()]);
		const now = Date.now();
		const hour = 60 * MINUTE_MS;

		// Busy 2-3h, 3-4h, and 6-8h from now; an order for 2.5h from now waits until just past 4h.
		await seedBusyTime(redis, bucket, new Date(now + 2 * hour), new Date(now + 3 * hour));
		await seedBusyTime(redis, bucket, new Date(now + 3 * hour), new Date(now + 4 * hour));
		await seedBusyTime(redis, bucket, new Date(now + 6 * hour), new Date(now + 8 * hour));

		const orderTime = new Date(now + 2.5 * hour);
		const result = await engine.validateOrderTime(orderTime, ["pickup"]);

		expect(result.waitPeriodSeconds).to.equal(toSeconds(new Date(now + 4 * hour)) + 1 - toSeconds(orderTime));
	});

	it("is not masked by an already-ended busy window (regression)", async () => {
		const { engine, redis, bucket } = createEngine([baseRule()]);
		const now = Date.now();

		// A stale window from hours ago must not hide the currently-active one.
		await seedBusyTime(redis, bucket, new Date(now - 3 * 60 * MINUTE_MS), new Date(now - 2 * 60 * MINUTE_MS));
		const activeEnd = new Date(now + 20 * MINUTE_MS);
		await seedBusyTime(redis, bucket, new Date(now - 10 * MINUTE_MS), activeEnd, 4);

		const orderTime = new Date(now);
		const result = await engine.validateOrderTime(orderTime, ["pickup"]);

		expect(result.waitPeriodSeconds).to.equal(toSeconds(activeEnd) + 1 - toSeconds(orderTime));
		expect(result.ordersInWindow).to.equal(4);
	});

	it("does not wait for windows that start after the requested time", async () => {
		const { engine, redis, bucket } = createEngine([baseRule()]);
		const now = Date.now();

		await seedBusyTime(redis, bucket, new Date(now + 60 * MINUTE_MS), new Date(now + 90 * MINUTE_MS));

		const result = await engine.validateOrderTime(new Date(now), ["pickup"]);

		expect(result).to.deep.equal({ waitPeriodSeconds: 0, ordersInWindow: 0 });
	});

	it("delays only the fulfillment types in a window's scope", async () => {
		const { engine, redis, bucket } = createEngine([baseRule()]);
		const now = Date.now();
		const end = new Date(now + 10 * MINUTE_MS);

		await seedBusyTime(redis, bucket, new Date(now - 5 * MINUTE_MS), end, 5, ["delivery"]);

		const delivery = await engine.validateOrderTime(new Date(now), ["delivery"]);
		const pickup = await engine.validateOrderTime(new Date(now), ["pickup"]);

		expect(delivery.waitPeriodSeconds).to.equal(toSeconds(end) + 1 - toSeconds(now));
		expect(pickup).to.deep.equal({ waitPeriodSeconds: 0, ordersInWindow: 0 });
	});

	it("applies catering-scoped windows only to catering orders", async () => {
		const { engine, redis, bucket } = createEngine([baseRule()]);
		const now = Date.now();
		const end = new Date(now + 10 * MINUTE_MS);

		await seedBusyTime(redis, bucket, new Date(now - 5 * MINUTE_MS), end, 5, ["delivery", "catering"]);

		const catering = await engine.validateOrderTime(new Date(now), ["delivery", "catering"]);
		const regular = await engine.validateOrderTime(new Date(now), ["delivery"]);

		expect(catering.waitPeriodSeconds).to.equal(toSeconds(end) + 1 - toSeconds(now));
		expect(regular).to.deep.equal({ waitPeriodSeconds: 0, ordersInWindow: 0 });
	});

	it("chains same-scope windows across windows scoped to other types", async () => {
		const { engine, redis, bucket } = createEngine([baseRule()]);
		const now = Date.now();
		const deliveryScope = ["delivery"];
		const pickupScope = ["pickup"];
		const secondEnd = new Date(now + 20 * MINUTE_MS);

		await seedBusyTime(redis, bucket, new Date(now - 5 * MINUTE_MS), new Date(now + 10 * MINUTE_MS), 5, deliveryScope);
		await seedBusyTime(redis, bucket, new Date(now + 2 * MINUTE_MS), new Date(now + 30 * MINUTE_MS), 5, pickupScope);
		await seedBusyTime(redis, bucket, new Date(now + 10 * MINUTE_MS), secondEnd, 5, deliveryScope);

		const orderTime = new Date(now);
		const result = await engine.validateOrderTime(orderTime, ["delivery"]);

		expect(result.waitPeriodSeconds).to.equal(toSeconds(secondEnd) + 1 - toSeconds(orderTime));
	});

	it("throws on invalid tags", async () => {
		const { engine } = createEngine([baseRule()]);
		let thrown: unknown;

		try {
			await engine.validateOrderTime(new Date(), [""]);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).to.be.instanceOf(TypeError);
	});
});
