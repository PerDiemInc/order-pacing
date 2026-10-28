import { randomUUID } from "node:crypto";
import { expect } from "chai";
import { format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type Redis from "ioredis";
import RedisMock from "ioredis-mock";
import { encodeBusyTime } from "../src/encoder";
import { Engine } from "../src/engine";
import EngineRule from "../src/engine/EngineRule";
import type { BusyTime, InputOrder, Order } from "../src/engine/types";
import { OrderSource, TimeframeMode } from "../src/engine/types";
import type { Rule, RuleTag } from "../src/rules/types";
import { toSeconds } from "../src/utils";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

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

function windowOrder(overrides: Partial<Order> = {}): Order {
	return { ...makeOrder(), orderTimeSeconds: 0, currentTimeSeconds: 0, ...overrides };
}

async function seedBusyTime(
	redis: Redis,
	bucket: string,
	{ start, end, totalOrders = 5, scope = [] }: { start: Date; end: Date; totalOrders?: number; scope?: RuleTag[] },
): Promise<void> {
	const busyTime: BusyTime = {
		busyTimeId: randomUUID(),
		ruleId: "rule-1",
		startTime: start,
		endTime: end,
		orderTimeSeconds: toSeconds(end),
		currentTimeSeconds: toSeconds(Date.now()),
		busyTimeSeconds: toSeconds(end) - toSeconds(start),
		scope,
		busyTimeContext: { totalAmountCents: 0, totalItems: 0, totalOrders, categoryIds: [] },
		threshold: { type: "orders", value: totalOrders, limit: 3, categoryIds: [] },
	};

	await redis.zadd(`busytimes:${bucket}`, toSeconds(end), encodeBusyTime(busyTime));
}

// A whole second an hour from now, so offsets in seconds land exactly on the window's edges.
function anchorTime(): number {
	return Math.floor(Date.now() / SECOND_MS) * SECOND_MS + HOUR_MS;
}

// The next given week day (0 = Sunday) at HH:mm in the time zone, at least a day from now.
function nextLocalTime(weekDay: number, time: string, timeZone: string): Date {
	const zonedNow = toZonedTime(new Date(), timeZone);

	for (let days = 1; days <= 7; days++) {
		const day = new Date(zonedNow.getFullYear(), zonedNow.getMonth(), zonedNow.getDate() + days);

		if (day.getDay() === weekDay) {
			return fromZonedTime(`${format(day, "yyyy-MM-dd")}T${time}:00`, timeZone);
		}
	}

	throw new Error("unreachable");
}

describe("Engine.add time window edges", () => {
	// A 30-minute time frame counts orders up to 29:59 away (TIME_FRAME_SECONDS_OFFSET).
	const cases: { timeframeMode: TimeframeMode; offsetSeconds: number; counted: boolean }[] = [
		{ timeframeMode: TimeframeMode.BEFORE_ONLY, offsetSeconds: -1799, counted: true },
		{ timeframeMode: TimeframeMode.BEFORE_ONLY, offsetSeconds: -1800, counted: false },
		{ timeframeMode: TimeframeMode.BEFORE_ONLY, offsetSeconds: 1, counted: false },
		{ timeframeMode: TimeframeMode.BEFORE_ONLY, offsetSeconds: 0, counted: true },
		{ timeframeMode: TimeframeMode.AFTER_ONLY, offsetSeconds: 1799, counted: true },
		{ timeframeMode: TimeframeMode.AFTER_ONLY, offsetSeconds: 1800, counted: false },
		{ timeframeMode: TimeframeMode.AFTER_ONLY, offsetSeconds: -1, counted: false },
		{ timeframeMode: TimeframeMode.CENTERED, offsetSeconds: -899, counted: true },
		{ timeframeMode: TimeframeMode.CENTERED, offsetSeconds: -900, counted: false },
		{ timeframeMode: TimeframeMode.CENTERED, offsetSeconds: 899, counted: true },
		{ timeframeMode: TimeframeMode.CENTERED, offsetSeconds: 900, counted: false },
		{ timeframeMode: TimeframeMode.BEFORE_AND_AFTER, offsetSeconds: -1799, counted: true },
		{ timeframeMode: TimeframeMode.BEFORE_AND_AFTER, offsetSeconds: -1800, counted: false },
		{ timeframeMode: TimeframeMode.BEFORE_AND_AFTER, offsetSeconds: 1799, counted: true },
		{ timeframeMode: TimeframeMode.BEFORE_AND_AFTER, offsetSeconds: 1800, counted: false },
	];

	for (const { timeframeMode, offsetSeconds, counted } of cases) {
		it(`${timeframeMode}: ${counted ? "counts" : "does not count"} an order ${offsetSeconds}s from the new one`, async () => {
			const { engine } = createEngine([baseRule({ maxOrders: 2 })], { timeframeMode });
			const anchor = anchorTime();

			await engine.add(makeOrder({ orderTime: new Date(anchor + offsetSeconds * SECOND_MS) }));
			await engine.add(makeOrder({ orderTime: new Date(anchor) }));

			expect(await engine.getBusyTimes()).to.have.length(counted ? 1 : 0);
		});
	}

	it("uses each rule's own time frame", async () => {
		const { engine } = createEngine([
			baseRule({ ruleId: "short", timeFrameMinutes: 10, maxOrders: 2 }),
			baseRule({ ruleId: "long", timeFrameMinutes: 60, maxOrders: 2 }),
		]);
		const anchor = anchorTime();

		await engine.add(makeOrder({ orderTime: new Date(anchor - 30 * MINUTE_MS) }));
		await engine.add(makeOrder({ orderTime: new Date(anchor) }));

		expect((await engine.getBusyTimes()).map((busyTime) => busyTime.ruleId)).to.deep.equal(["long"]);
	});

	it("counts orders added out of time order", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: 3 })], {
			timeframeMode: TimeframeMode.BEFORE_AND_AFTER,
		});
		const anchor = anchorTime();

		await engine.add(makeOrder({ orderTime: new Date(anchor + 10 * MINUTE_MS) }));
		await engine.add(makeOrder({ orderTime: new Date(anchor - 10 * MINUTE_MS) }));

		expect(await engine.getBusyTimes()).to.have.length(0);

		await engine.add(makeOrder({ orderTime: new Date(anchor) }));

		expect(await engine.getBusyTimes()).to.have.length(1);
	});
});

describe("Engine.add busy window placement", () => {
	it("ends a past order's window busyTimeMinutes from now", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: 1 })]);
		const now = Date.now();

		await engine.add(makeOrder({ orderTime: new Date(now - 10 * MINUTE_MS) }));

		const [busyTime] = await engine.getBusyTimes();

		expect(toSeconds(busyTime.endTime)).to.be.closeTo(toSeconds(now) + 15 * 60, 2);
		expect(busyTime.busyTimeSeconds).to.equal(15 * 60);
	});

	it("ends an order's window busyTimeMinutes from now while the order is sooner than that", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: 1 })]);
		const now = Date.now();

		await engine.add(makeOrder({ orderTime: new Date(now + 5 * MINUTE_MS) }));

		const [busyTime] = await engine.getBusyTimes();

		expect(toSeconds(busyTime.endTime)).to.be.closeTo(toSeconds(now) + 15 * 60, 2);
	});

	it("uses each rule's own busy time", async () => {
		const { engine } = createEngine([
			baseRule({ ruleId: "short", busyTimeMinutes: 5, maxOrders: 1 }),
			baseRule({ ruleId: "long", busyTimeMinutes: 45, maxOrders: 1 }),
		]);
		const orderTime = new Date(anchorTime());

		await engine.add(makeOrder({ orderTime }));

		const busyTimes = await engine.getBusyTimes();
		const lengthOf = (ruleId: string) => {
			const busyTime = busyTimes.find((candidate) => candidate.ruleId === ruleId) as BusyTime;

			return toSeconds(busyTime.endTime) - toSeconds(busyTime.startTime);
		};

		expect(lengthOf("short")).to.equal(5 * 60 - 1);
		expect(lengthOf("long")).to.equal(45 * 60 - 1);
	});

	it("records the order and current time the window was made for", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: 1 })]);
		const orderTime = new Date(anchorTime());
		const before = toSeconds(Date.now());

		await engine.add(makeOrder({ orderTime }));

		const [busyTime] = await engine.getBusyTimes();

		expect(busyTime.orderTimeSeconds).to.equal(toSeconds(orderTime));
		expect(busyTime.currentTimeSeconds).to.be.within(before, toSeconds(Date.now()));
		expect(busyTime.busyTimeId).to.be.a("string").with.length.greaterThan(0);
	});

	it("adds another window for every order past the limit", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: 2 })]);
		const anchor = anchorTime();

		for (let index = 0; index < 4; index++) {
			await engine.add(makeOrder({ orderTime: new Date(anchor + index * MINUTE_MS) }));
		}

		const busyTimes = await engine.getBusyTimes();

		expect(busyTimes).to.have.length(3);
		expect(busyTimes.map((busyTime) => busyTime.threshold.value)).to.deep.equal([2, 3, 4]);
	});
});

describe("Engine.add thresholds", () => {
	it("reports orders when several thresholds are reached at once", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: 1, maxItems: 1, maxAmountCents: 100 })]);

		await engine.add(makeOrder());

		const [busyTime] = await engine.getBusyTimes();

		expect(busyTime.threshold.type).to.equal("orders");
	});

	it("reports items before amount when orders are under the limit", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: 5, maxItems: 2, maxAmountCents: 100 })]);

		await engine.add(makeOrder({ items: [{ itemId: "a", quantity: 2, totalAmountCents: 500, categoryId: null }] }));

		const [busyTime] = await engine.getBusyTimes();

		expect(busyTime.threshold).to.deep.include({ type: "items", value: 2, limit: 2 });
	});

	it("trips on a single order whose items alone reach maxItems", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: undefined, maxItems: 10 })]);

		await engine.add(makeOrder({ items: [{ itemId: "a", quantity: 10, totalAmountCents: 100, categoryId: null }] }));

		expect(await engine.getBusyTimes()).to.have.length(1);
	});

	it("does not trip one below maxItems or maxAmountCents", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: undefined, maxItems: 3, maxAmountCents: 3000 })]);

		await engine.add(
			makeOrder({
				totalAmountCents: 2999,
				items: [{ itemId: "a", quantity: 2, totalAmountCents: 2999, categoryId: null }],
			}),
		);

		expect(await engine.getBusyTimes()).to.have.length(0);
	});

	it("counts an item without a quantity as one", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: undefined, maxItems: 2 })]);
		const item = { itemId: "a", totalAmountCents: 100, categoryId: null } as unknown as InputOrder["items"][number];

		await engine.add(makeOrder({ items: [item] }));

		expect(await engine.getBusyTimes()).to.have.length(0);

		await engine.add(makeOrder({ items: [item] }));

		expect(await engine.getBusyTimes()).to.have.length(1);
	});

	it("counts only the rule's categories toward maxItems and maxAmountCents", async () => {
		const { engine } = createEngine([
			baseRule({ ruleId: "sweet-items", categoryIds: ["sweet"], maxOrders: undefined, maxItems: 3 }),
			baseRule({ ruleId: "sweet-amount", categoryIds: ["sweet"], maxOrders: undefined, maxAmountCents: 1500 }),
		]);
		const items = [
			{ itemId: "a", quantity: 2, totalAmountCents: 1000, categoryId: "sweet" },
			{ itemId: "b", quantity: 5, totalAmountCents: 5000, categoryId: "fancy" },
		];

		await engine.add(makeOrder({ totalAmountCents: 6000, items }));

		expect(await engine.getBusyTimes()).to.have.length(0);

		await engine.add(
			makeOrder({
				totalAmountCents: 500,
				items: [{ itemId: "c", quantity: 1, totalAmountCents: 500, categoryId: "sweet" }],
			}),
		);

		const busyTimes = await engine.getBusyTimes();

		expect(busyTimes.map((busyTime) => busyTime.ruleId).sort()).to.deep.equal(["sweet-amount", "sweet-items"]);
		expect(busyTimes.find((busyTime) => busyTime.ruleId === "sweet-items")?.threshold.value).to.equal(3);
		expect(busyTimes.find((busyTime) => busyTime.ruleId === "sweet-amount")?.threshold.value).to.equal(1500);
	});

	it("counts an order once toward maxOrders however many of the rule's categories it holds", async () => {
		const { engine } = createEngine([baseRule({ categoryIds: ["sweet", "fancy"], maxOrders: 2 })]);

		await engine.add(
			makeOrder({
				items: [
					{ itemId: "a", quantity: 1, totalAmountCents: 100, categoryId: "sweet" },
					{ itemId: "b", quantity: 1, totalAmountCents: 100, categoryId: "fancy" },
				],
			}),
		);

		expect(await engine.getBusyTimes()).to.have.length(0);
	});

	it("stores the unfiltered window totals with the window", async () => {
		const { engine } = createEngine([baseRule({ tags: ["delivery"], categoryIds: ["sweet"], maxOrders: 1 })]);
		const anchor = anchorTime();

		await engine.add(
			makeOrder({
				orderTime: new Date(anchor - MINUTE_MS),
				totalAmountCents: 700,
				items: [{ itemId: "a", quantity: 3, totalAmountCents: 700, categoryId: "fancy" }],
			}),
		);
		await engine.add(
			makeOrder({
				orderTime: new Date(anchor),
				tags: ["delivery"],
				totalAmountCents: 300,
				items: [{ itemId: "b", quantity: 1, totalAmountCents: 300, categoryId: "sweet" }],
			}),
		);

		const [busyTime] = await engine.getBusyTimes();

		expect(busyTime.busyTimeContext).to.deep.equal({
			totalAmountCents: 1000,
			totalItems: 4,
			totalOrders: 2,
			categoryIds: ["fancy", "sweet"],
		});
		expect(busyTime.threshold).to.deep.equal({ type: "orders", value: 1, limit: 1, categoryIds: ["sweet"] });
	});
});

describe("EngineRule.thresholdCheck with incomplete orders", () => {
	it("counts an order without items toward maxOrders only", () => {
		const engineRule = new EngineRule(baseRule({ maxOrders: 1 }));
		const order = windowOrder({ items: undefined as unknown as Order["items"] });

		expect(engineRule.thresholdCheck([order])?.threshold).to.deep.include({ type: "orders", value: 1 });
	});

	it("treats a missing order total as zero", () => {
		const engineRule = new EngineRule(baseRule({ maxOrders: undefined, maxAmountCents: 100 }));
		const order = windowOrder({ totalAmountCents: undefined as unknown as number });

		expect(engineRule.thresholdCheck([order])).to.equal(null);
	});

	it("treats missing item amounts as zero within the rule's categories", () => {
		const engineRule = new EngineRule(
			baseRule({ categoryIds: ["sweet"], maxOrders: undefined, maxItems: 2, maxAmountCents: 100 }),
		);
		const item = { itemId: "a", categoryId: "sweet" } as unknown as Order["items"][number];

		expect(engineRule.thresholdCheck([windowOrder({ items: [item, item] })])?.threshold).to.deep.include({
			type: "items",
			value: 2,
		});
	});
});

describe("Engine.add schedules", () => {
	const NEW_YORK = "America/New_York";

	it("trips a rule only inside its days and hours, in the engine's time zone", async () => {
		const rule = baseRule({ weekDays: [1], startTime: "11:00", endTime: "14:00", maxOrders: 1 });
		const cases = [
			{ name: "Monday 12:00", orderTime: nextLocalTime(1, "12:00", NEW_YORK), trips: true },
			{ name: "Monday 11:00", orderTime: nextLocalTime(1, "11:00", NEW_YORK), trips: true },
			{ name: "Monday 14:00", orderTime: nextLocalTime(1, "14:00", NEW_YORK), trips: true },
			{ name: "Monday 10:59", orderTime: nextLocalTime(1, "10:59", NEW_YORK), trips: false },
			{ name: "Monday 14:01", orderTime: nextLocalTime(1, "14:01", NEW_YORK), trips: false },
			{ name: "Tuesday 12:00", orderTime: nextLocalTime(2, "12:00", NEW_YORK), trips: false },
		];

		for (const { name, orderTime, trips } of cases) {
			const { engine } = createEngine([rule], { timeZone: NEW_YORK });

			await engine.add(makeOrder({ orderTime }));

			expect(await engine.getBusyTimes(), name).to.have.length(trips ? 1 : 0);
		}
	});

	it("reads the order's local day, not the UTC one", async () => {
		const rule = baseRule({ weekDays: [1], startTime: "23:00", endTime: "23:59", maxOrders: 1 });
		// Monday 23:30 in New York is already Tuesday in UTC.
		const orderTime = nextLocalTime(1, "23:30", NEW_YORK);
		const newYork = createEngine([rule], { timeZone: NEW_YORK });
		const utc = createEngine([rule]);

		await newYork.engine.add(makeOrder({ orderTime }));
		await utc.engine.add(makeOrder({ orderTime }));

		expect(await newYork.engine.getBusyTimes()).to.have.length(1);
		expect(await utc.engine.getBusyTimes()).to.have.length(0);
	});

	it("trips only the slot an order falls in when a rule has several", async () => {
		const { engine } = createEngine(
			[
				baseRule({ ruleId: "lunch", startTime: "11:00", endTime: "14:00", maxOrders: 1 }),
				baseRule({ ruleId: "dinner", startTime: "17:00", endTime: "21:00", maxOrders: 1 }),
			],
			{ timeZone: NEW_YORK },
		);

		await engine.add(makeOrder({ orderTime: nextLocalTime(3, "18:30", NEW_YORK) }));

		expect((await engine.getBusyTimes()).map((busyTime) => busyTime.ruleId)).to.deep.equal(["dinner"]);
	});

	it("counts orders from just before a slot toward it once an order inside trips it", async () => {
		const { engine } = createEngine([baseRule({ startTime: "11:00", endTime: "14:00", maxOrders: 2 })], {
			timeZone: NEW_YORK,
		});

		await engine.add(makeOrder({ orderTime: nextLocalTime(4, "10:50", NEW_YORK) }));

		expect(await engine.getBusyTimes()).to.have.length(0);

		await engine.add(makeOrder({ orderTime: nextLocalTime(4, "11:05", NEW_YORK) }));

		expect(await engine.getBusyTimes()).to.have.length(1);
	});
});

describe("Engine sources and storage", () => {
	it("stores orders without making windows when there are no rules", async () => {
		const { engine } = createEngine([]);

		await engine.add(makeOrder());
		await engine.add(makeOrder());

		expect(await engine.getOrders()).to.have.length(2);
		expect(await engine.getBusyTimes()).to.have.length(0);
	});

	it("never trips on a non-PERDIEM order, even one that alone reaches the limit", async () => {
		const { engine } = createEngine([baseRule({ maxOrders: 1 })]);

		await engine.add(makeOrder({ source: OrderSource.OTHER }));

		expect(await engine.getBusyTimes()).to.have.length(0);
		expect((await engine.getOrders())[0].source).to.equal(OrderSource.OTHER);
	});

	it("keeps two engines' buckets apart on the same Redis", async () => {
		const redis = new RedisMock() as unknown as Redis;
		const first = new Engine({ bucket: `test:${randomUUID()}`, redis, rules: [baseRule({ maxOrders: 1 })] });
		const second = new Engine({ bucket: `test:${randomUUID()}`, redis, rules: [baseRule({ maxOrders: 1 })] });

		await first.add(makeOrder());

		expect(await first.getOrders()).to.have.length(1);
		expect(await second.getOrders()).to.have.length(0);
		expect(await second.getBusyTimes()).to.have.length(0);
	});

	it("round-trips an order's fields through Redis", async () => {
		const { engine } = createEngine([]);
		const order = makeOrder({
			orderTime: new Date(anchorTime()),
			totalAmountCents: 4321,
			tags: ["delivery", "catering"],
			items: [{ itemId: "a", quantity: 3, totalAmountCents: 4321, categoryId: "sweet" }],
		});

		await engine.add(order);

		const [stored] = await engine.getOrders();

		expect(stored).to.deep.include({
			orderId: order.orderId,
			totalAmountCents: 4321,
			source: OrderSource.PERDIEM,
			tags: ["delivery", "catering"],
			orderTimeSeconds: toSeconds(order.orderTime),
		});
		expect(stored.orderTime.getTime()).to.equal(order.orderTime.getTime());
		expect(stored.items).to.deep.equal(order.items);
	});

	it("drops windows made more than a day ago", async () => {
		const { engine, redis, bucket } = createEngine([]);
		const now = Date.now();

		await seedBusyTime(redis, bucket, {
			start: new Date(now - DAY_MS - HOUR_MS),
			end: new Date(now - DAY_MS - MINUTE_MS),
		});
		await seedBusyTime(redis, bucket, { start: new Date(now - 2 * HOUR_MS), end: new Date(now - HOUR_MS) });

		expect(await engine.getBusyTimes()).to.have.length(1);
	});

	it("lists windows by start time whatever order they were stored in", async () => {
		const { engine, redis, bucket } = createEngine([]);
		// Stored times keep whole seconds.
		const now = anchorTime();
		const at = (minutes: number) => new Date(now + minutes * MINUTE_MS);

		await seedBusyTime(redis, bucket, { start: at(30), end: at(40) });
		await seedBusyTime(redis, bucket, { start: at(0), end: at(60) });
		await seedBusyTime(redis, bucket, { start: at(10), end: at(20) });

		const starts = (await engine.getBusyTimes()).map((busyTime) => busyTime.startTime.getTime());

		expect(starts).to.deep.equal([at(0), at(10), at(30)].map((date) => date.getTime()));
	});
});

describe("Engine.getOrdersStats", () => {
	it("lists orders of both sources in the range, earliest first", async () => {
		const { engine } = createEngine([]);
		const anchor = anchorTime();
		const at = (minutes: number) => new Date(anchor + minutes * MINUTE_MS);

		await engine.add(makeOrder({ orderId: "late", orderTime: at(20) }));
		await engine.add(makeOrder({ orderId: "other", orderTime: at(10), source: OrderSource.OTHER }));
		await engine.add(makeOrder({ orderId: "early", orderTime: at(0) }));
		await engine.add(makeOrder({ orderId: "outside", orderTime: at(40) }));

		const stats = await engine.getOrdersStats(at(0), at(20));

		expect(stats).to.deep.equal([
			{ orderId: "early", orderTime: at(0), source: OrderSource.PERDIEM },
			{ orderId: "other", orderTime: at(10), source: OrderSource.OTHER },
			{ orderId: "late", orderTime: at(20), source: OrderSource.PERDIEM },
		]);
	});

	it("returns nothing for a range without orders", async () => {
		const { engine } = createEngine([]);
		const anchor = anchorTime();

		await engine.add(makeOrder({ orderTime: new Date(anchor) }));

		expect(await engine.getOrdersStats(new Date(anchor + MINUTE_MS), new Date(anchor + HOUR_MS))).to.deep.equal([]);
	});

	it("leaves out orders past the retention window", async () => {
		const { engine } = createEngine([]);
		const now = Date.now();

		await engine.add(makeOrder({ orderId: "old", orderTime: new Date(now - 8 * DAY_MS) }));

		expect(await engine.getOrdersStats(new Date(now - 9 * DAY_MS), new Date(now))).to.deep.equal([]);
	});
});

describe("Engine.validateOrderTime window edges", () => {
	it("delays an order at the window's first second", async () => {
		const { engine, redis, bucket } = createEngine([]);
		const start = new Date(anchorTime());
		const end = new Date(start.getTime() + 10 * MINUTE_MS);

		await seedBusyTime(redis, bucket, { start, end });

		const { waitPeriodSeconds } = await engine.validateOrderTime({ orderTime: start });

		expect(waitPeriodSeconds).to.equal(10 * 60 + 1);
	});

	it("delays an order at the window's last second by one second", async () => {
		const { engine, redis, bucket } = createEngine([]);
		const start = new Date(anchorTime());
		const end = new Date(start.getTime() + 10 * MINUTE_MS);

		await seedBusyTime(redis, bucket, { start, end });

		expect((await engine.validateOrderTime({ orderTime: end })).waitPeriodSeconds).to.equal(1);
	});

	it("does not delay an order a second either side of the window", async () => {
		const { engine, redis, bucket } = createEngine([]);
		const start = new Date(anchorTime());
		const end = new Date(start.getTime() + 10 * MINUTE_MS);

		await seedBusyTime(redis, bucket, { start, end });

		for (const orderTime of [new Date(start.getTime() - SECOND_MS), new Date(end.getTime() + SECOND_MS)]) {
			expect(await engine.validateOrderTime({ orderTime })).to.deep.equal({ waitPeriodSeconds: 0, ordersInWindow: 0 });
		}
	});

	it("chains a window starting the second after another ends", async () => {
		const { engine, redis, bucket } = createEngine([]);
		const start = anchorTime();
		const firstEnd = new Date(start + 10 * MINUTE_MS);
		const secondEnd = new Date(start + 20 * MINUTE_MS);

		await seedBusyTime(redis, bucket, { start: new Date(start), end: firstEnd });
		await seedBusyTime(redis, bucket, { start: new Date(firstEnd.getTime() + SECOND_MS), end: secondEnd });

		const { waitPeriodSeconds } = await engine.validateOrderTime({ orderTime: new Date(start) });

		expect(waitPeriodSeconds).to.equal(toSeconds(secondEnd) + 1 - toSeconds(start));
	});

	it("stops at a gap of two seconds between windows", async () => {
		const { engine, redis, bucket } = createEngine([]);
		const start = anchorTime();
		const firstEnd = new Date(start + 10 * MINUTE_MS);

		await seedBusyTime(redis, bucket, { start: new Date(start), end: firstEnd });
		await seedBusyTime(redis, bucket, {
			start: new Date(firstEnd.getTime() + 2 * SECOND_MS),
			end: new Date(start + 20 * MINUTE_MS),
		});

		const { waitPeriodSeconds } = await engine.validateOrderTime({ orderTime: new Date(start) });

		expect(waitPeriodSeconds).to.equal(toSeconds(firstEnd) + 1 - toSeconds(start));
	});

	it("waits for the outer window when one window sits inside another", async () => {
		const { engine, redis, bucket } = createEngine([]);
		const start = anchorTime();
		const outerEnd = new Date(start + 60 * MINUTE_MS);

		await seedBusyTime(redis, bucket, {
			start: new Date(start + 10 * MINUTE_MS),
			end: new Date(start + 20 * MINUTE_MS),
			totalOrders: 9,
		});
		await seedBusyTime(redis, bucket, { start: new Date(start), end: outerEnd, totalOrders: 4 });

		const result = await engine.validateOrderTime({ orderTime: new Date(start + 5 * MINUTE_MS) });

		expect(result).to.deep.equal({
			waitPeriodSeconds: toSeconds(outerEnd) + 1 - toSeconds(start + 5 * MINUTE_MS),
			ordersInWindow: 4,
		});
	});

	it("reports the orders of the last window it waited for", async () => {
		const { engine, redis, bucket } = createEngine([]);
		const start = anchorTime();

		await seedBusyTime(redis, bucket, {
			start: new Date(start),
			end: new Date(start + 10 * MINUTE_MS),
			totalOrders: 3,
		});
		await seedBusyTime(redis, bucket, {
			start: new Date(start + 5 * MINUTE_MS),
			end: new Date(start + 20 * MINUTE_MS),
			totalOrders: 6,
		});

		expect((await engine.validateOrderTime({ orderTime: new Date(start) })).ordersInWindow).to.equal(6);
	});
});

describe("Engine add then validateOrderTime", () => {
	it("offers the second after a tripped window, and that time is free", async () => {
		const { engine } = createEngine([baseRule({ tags: ["pickup"], maxOrders: 2 })]);
		const anchor = anchorTime();

		await engine.add(makeOrder({ orderTime: new Date(anchor - 5 * MINUTE_MS) }));
		await engine.add(makeOrder({ orderTime: new Date(anchor) }));

		const [busyTime] = await engine.getBusyTimes();
		const wanted = new Date(anchor - 5 * MINUTE_MS);
		const { waitPeriodSeconds, ordersInWindow } = await engine.validateOrderTime({
			orderTime: wanted,
			tags: ["pickup"],
		});
		const offered = new Date(wanted.getTime() + waitPeriodSeconds * SECOND_MS);

		expect(offered.getTime()).to.equal(busyTime.endTime.getTime() + SECOND_MS);
		expect(ordersInWindow).to.equal(2);
		expect(await engine.validateOrderTime({ orderTime: offered, tags: ["pickup"] })).to.deep.equal({
			waitPeriodSeconds: 0,
			ordersInWindow: 0,
		});
	});

	it("leaves other fulfillment types free while one is busy", async () => {
		const { engine } = createEngine([baseRule({ tags: ["pickup"], maxOrders: 1 })]);
		const orderTime = new Date(anchorTime());

		await engine.add(makeOrder({ orderTime }));

		const busyAt = new Date(orderTime.getTime() - MINUTE_MS);

		expect(
			(await engine.validateOrderTime({ orderTime: busyAt, tags: ["pickup"] })).waitPeriodSeconds,
		).to.be.greaterThan(0);
		expect(await engine.validateOrderTime({ orderTime: busyAt, tags: ["delivery"] })).to.deep.equal({
			waitPeriodSeconds: 0,
			ordersInWindow: 0,
		});
	});
});
