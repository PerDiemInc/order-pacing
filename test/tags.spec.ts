import { randomUUID } from "node:crypto";
import { expect } from "chai";
import type Redis from "ioredis";
import RedisMock from "ioredis-mock";
import { Packr } from "msgpackr";
import { encodeBusyTime } from "../src/encoder";
import { Engine } from "../src/engine";
import EngineRule from "../src/engine/EngineRule";
import type { BusyTime, InputOrder, Order } from "../src/engine/types";
import { OrderSource } from "../src/engine/types";
import type { Rule, RuleTag } from "../src/rules/types";
import { matchesTags, toSeconds } from "../src/utils";

const MINUTE_MS = 60 * 1000;

// The tags as webhook-worker builds them: an order carries its fulfillment type and whether it is catering;
// a rule carries the types ticked on it (several in one list) and its catering filter.
const FULFILLMENT_TYPES = ["pickup", "delivery", "curbside"] as const;
const CATERING_FILTERS = [undefined, "catering", "non-catering"] as const;

type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];
type CateringFilter = (typeof CATERING_FILTERS)[number];

type RuleConfig = { types: FulfillmentType[]; catering: CateringFilter };
type OrderKind = { type: FulfillmentType; catering: boolean };

function subsets<T>(values: readonly T[]): T[][] {
	const all: T[][] = [[]];

	for (const value of values) {
		for (const subset of all.slice()) {
			all.push([...subset, value]);
		}
	}

	return all;
}

const RULE_CONFIGS: RuleConfig[] = subsets(FULFILLMENT_TYPES).flatMap((types) =>
	CATERING_FILTERS.map((catering) => ({ types, catering })),
);

const ORDER_KINDS: OrderKind[] = FULFILLMENT_TYPES.flatMap((type) =>
	[false, true].map((catering) => ({ type, catering })),
);

function ruleTags({ types, catering }: RuleConfig): RuleTag[] {
	return [...(types.length > 1 ? [types] : types), ...(catering ? [catering] : [])];
}

function orderTags({ type, catering }: OrderKind): string[] {
	return [type, catering ? "catering" : "non-catering"];
}

// What the dashboard promises, worked out without matchesTags: no types ticked means every type, and the
// catering filter (when set) must agree with the order.
function ruleCoversOrder(rule: RuleConfig, order: OrderKind): boolean {
	const typeMatches = rule.types.length === 0 || rule.types.includes(order.type);
	const cateringMatches = rule.catering === undefined || (rule.catering === "catering") === order.catering;

	return typeMatches && cateringMatches;
}

function describeRule(rule: RuleConfig): string {
	const types = rule.types.length ? rule.types.join("+") : "any type";

	return `${types}, ${rule.catering ?? "catering or not"}`;
}

function describeOrder(order: OrderKind): string {
	return `${order.catering ? "catering" : "regular"} ${order.type}`;
}

function baseRule(overrides: Partial<Rule> = {}): Rule {
	return {
		ruleId: "rule-1",
		timeFrameMinutes: 30,
		busyTimeMinutes: 15,
		categoryIds: [],
		weekDays: [],
		maxOrders: 1,
		...overrides,
	};
}

function createEngine(rules: Rule[]) {
	const bucket = `test:${randomUUID()}`;
	const redis = new RedisMock() as unknown as Redis;
	const engine = new Engine({ bucket, redis, rules });

	return { engine, redis, bucket };
}

function makeOrder(overrides: Partial<InputOrder> = {}): InputOrder {
	return {
		orderId: randomUUID(),
		orderTime: new Date(),
		totalAmountCents: 1000,
		source: OrderSource.PERDIEM,
		tags: ["pickup", "non-catering"],
		items: [{ itemId: "item-1", quantity: 1, totalAmountCents: 1000, categoryId: null }],
		...overrides,
	};
}

async function seedBusyTime(
	redis: Redis,
	bucket: string,
	{ start, end, scope }: { start: Date; end: Date; scope: RuleTag[] },
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
		busyTimeContext: { totalAmountCents: 0, totalItems: 0, totalOrders: 3, categoryIds: [] },
		threshold: { type: "orders", value: 3, limit: 3, categoryIds: [] },
	};

	await redis.zadd(`busytimes:${bucket}`, toSeconds(end), encodeBusyTime(busyTime));
}

describe("tag matrix: every rule the dashboard can save against every order kind", () => {
	it("covers 8 type selections x 3 catering filters and 3 types x catering or not", () => {
		expect(RULE_CONFIGS).to.have.length(24);
		expect(ORDER_KINDS).to.have.length(6);
	});

	for (const rule of RULE_CONFIGS) {
		describe(`rule for ${describeRule(rule)} (tags ${JSON.stringify(ruleTags(rule))})`, () => {
			const covered = ORDER_KINDS.filter((order) => ruleCoversOrder(rule, order));

			it(`matches exactly ${covered.map(describeOrder).join(", ") || "no order"}`, () => {
				for (const order of ORDER_KINDS) {
					expect(matchesTags(ruleTags(rule), orderTags(order)), describeOrder(order)).to.equal(
						ruleCoversOrder(rule, order),
					);
				}
			});

			it("applies EngineRule only to the orders it covers", () => {
				const engineRule = new EngineRule(baseRule({ tags: ruleTags(rule) }));

				for (const order of ORDER_KINDS) {
					const engineOrder: Order = {
						...makeOrder({ tags: orderTags(order) }),
						orderTimeSeconds: 0,
						currentTimeSeconds: 0,
					};

					expect(engineRule.applyCheck(engineOrder, "UTC"), describeOrder(order)).to.equal(
						ruleCoversOrder(rule, order),
					);
				}
			});

			it("trips on an order it covers and stamps its tags as the busy time's scope", async () => {
				for (const order of ORDER_KINDS) {
					const { engine } = createEngine([baseRule({ tags: ruleTags(rule) })]);

					await engine.add(makeOrder({ tags: orderTags(order) }));

					const busyTimes = await engine.getBusyTimes();

					expect(busyTimes, describeOrder(order)).to.have.length(ruleCoversOrder(rule, order) ? 1 : 0);

					for (const busyTime of busyTimes) {
						expect(busyTime.scope).to.deep.equal(ruleTags(rule));
					}
				}
			});

			it("delays exactly the orders it covers once busy", async () => {
				const { engine, redis, bucket } = createEngine([]);
				const now = Date.now();
				const end = new Date(now + 10 * MINUTE_MS);

				await seedBusyTime(redis, bucket, { start: new Date(now - 5 * MINUTE_MS), end, scope: ruleTags(rule) });

				for (const order of ORDER_KINDS) {
					const { waitPeriodSeconds } = await engine.validateOrderTime({
						orderTime: new Date(now),
						tags: orderTags(order),
					});

					expect(waitPeriodSeconds, describeOrder(order)).to.equal(
						ruleCoversOrder(rule, order) ? toSeconds(end) + 1 - toSeconds(now) : 0,
					);
				}
			});
		});
	}
});

describe("tag matrix: a rule's limit is shared by the types it covers", () => {
	for (const rule of RULE_CONFIGS) {
		const covered = ORDER_KINDS.filter((order) => ruleCoversOrder(rule, order));
		const notCovered = ORDER_KINDS.filter((order) => !ruleCoversOrder(rule, order));

		if (covered.length < 2) {
			continue;
		}

		it(`${describeRule(rule)}: one order of each covered kind counts toward one limit`, async () => {
			const { engine } = createEngine([baseRule({ tags: ruleTags(rule), maxOrders: covered.length })]);
			const now = Date.now();

			for (const [index, order] of covered.slice(0, -1).entries()) {
				await engine.add(makeOrder({ orderTime: new Date(now - (index + 1) * MINUTE_MS), tags: orderTags(order) }));
			}

			expect(await engine.getBusyTimes()).to.have.length(0);

			await engine.add(makeOrder({ orderTime: new Date(now), tags: orderTags(covered[covered.length - 1]) }));

			const [busyTime] = await engine.getBusyTimes();

			expect(busyTime.threshold).to.deep.include({ type: "orders", value: covered.length, limit: covered.length });
		});

		if (notCovered.length === 0) {
			continue;
		}

		it(`${describeRule(rule)}: orders it does not cover never count toward its limit`, async () => {
			const { engine } = createEngine([baseRule({ tags: ruleTags(rule), maxOrders: 2 })]);
			const now = Date.now();

			for (const [index, order] of notCovered.entries()) {
				await engine.add(makeOrder({ orderTime: new Date(now - (index + 2) * MINUTE_MS), tags: orderTags(order) }));
			}

			await engine.add(makeOrder({ orderTime: new Date(now), tags: orderTags(covered[0]) }));

			expect(await engine.getBusyTimes()).to.have.length(0);
		});
	}
});

describe("tag isolation between rules", () => {
	it("keeps one rule per fulfillment type independent of the others", async () => {
		const { engine } = createEngine(
			FULFILLMENT_TYPES.map((type) => baseRule({ ruleId: `${type}-cap`, tags: [type], maxOrders: 2 })),
		);
		const now = Date.now();

		await engine.add(makeOrder({ orderTime: new Date(now - 3 * MINUTE_MS), tags: ["pickup", "non-catering"] }));
		await engine.add(makeOrder({ orderTime: new Date(now - 2 * MINUTE_MS), tags: ["delivery", "non-catering"] }));
		await engine.add(makeOrder({ orderTime: new Date(now - MINUTE_MS), tags: ["curbside", "non-catering"] }));

		expect(await engine.getBusyTimes()).to.have.length(0);

		await engine.add(makeOrder({ orderTime: new Date(now), tags: ["delivery", "catering"] }));

		const busyTimes = await engine.getBusyTimes();

		expect(busyTimes.map((busyTime) => busyTime.ruleId)).to.deep.equal(["delivery-cap"]);
		expect(busyTimes[0].scope).to.deep.equal(["delivery"]);
	});

	it("trips a pair rule and a single-type rule from the same order when both cover it", async () => {
		const { engine } = createEngine([
			baseRule({ ruleId: "pickup-or-delivery", tags: [["pickup", "delivery"]], maxOrders: 2 }),
			baseRule({ ruleId: "delivery-only", tags: ["delivery"], maxOrders: 2 }),
		]);
		const now = Date.now();

		await engine.add(makeOrder({ orderTime: new Date(now - MINUTE_MS), tags: ["pickup", "non-catering"] }));
		await engine.add(makeOrder({ orderTime: new Date(now), tags: ["delivery", "non-catering"] }));

		expect((await engine.getBusyTimes()).map((busyTime) => busyTime.ruleId)).to.deep.equal(["pickup-or-delivery"]);

		await engine.add(makeOrder({ orderTime: new Date(now), tags: ["delivery", "non-catering"] }));

		const ruleIds = (await engine.getBusyTimes()).map((busyTime) => busyTime.ruleId).sort();

		expect(ruleIds).to.deep.equal(["delivery-only", "pickup-or-delivery", "pickup-or-delivery"]);
	});

	it("splits catering and regular limits for the same fulfillment type", async () => {
		const { engine } = createEngine([
			baseRule({ ruleId: "catering-delivery", tags: ["delivery", "catering"], maxOrders: 2 }),
			baseRule({ ruleId: "regular-delivery", tags: ["delivery", "non-catering"], maxOrders: 2 }),
		]);
		const now = Date.now();

		await engine.add(makeOrder({ orderTime: new Date(now - MINUTE_MS), tags: ["delivery", "catering"] }));
		await engine.add(makeOrder({ orderTime: new Date(now), tags: ["delivery", "non-catering"] }));

		expect(await engine.getBusyTimes()).to.have.length(0);

		await engine.add(makeOrder({ orderTime: new Date(now), tags: ["delivery", "catering"] }));

		expect((await engine.getBusyTimes()).map((busyTime) => busyTime.ruleId)).to.deep.equal(["catering-delivery"]);
	});

	it("delays each order kind only by the windows of rules covering it", async () => {
		const { engine, redis, bucket } = createEngine([]);
		const now = Date.now();
		const at = (minutes: number) => new Date(now + minutes * MINUTE_MS);

		await seedBusyTime(redis, bucket, { start: at(-5), end: at(10), scope: ["pickup"] });
		await seedBusyTime(redis, bucket, { start: at(-5), end: at(20), scope: [["delivery", "curbside"]] });
		await seedBusyTime(redis, bucket, { start: at(-5), end: at(30), scope: ["curbside", "catering"] });

		const waitFor = async (tags: string[]) =>
			(await engine.validateOrderTime({ orderTime: new Date(now), tags })).waitPeriodSeconds;
		const waitUntil = (date: Date) => toSeconds(date) + 1 - toSeconds(now);

		expect(await waitFor(["pickup", "non-catering"])).to.equal(waitUntil(at(10)));
		expect(await waitFor(["pickup", "catering"])).to.equal(waitUntil(at(10)));
		expect(await waitFor(["delivery", "non-catering"])).to.equal(waitUntil(at(20)));
		expect(await waitFor(["curbside", "non-catering"])).to.equal(waitUntil(at(20)));
		expect(await waitFor(["curbside", "catering"])).to.equal(waitUntil(at(30)));
	});
});

describe("tags on orders and windows written before tags existed", () => {
	const packr = new Packr({ useRecords: true, useTimestamp32: true });

	async function seedLegacyOrder(redis: Redis, bucket: string, orderTime: Date): Promise<void> {
		const legacy = packr.pack({
			id: randomUUID(),
			is: [{ id: "item-1", q: 1, ta: 1000, c: null }],
			ta: 1000,
			s: "P",
			ot: orderTime,
			ots: toSeconds(orderTime),
			cts: toSeconds(Date.now()),
		});

		await redis.zadd(`orders:${bucket}`, toSeconds(orderTime), legacy);
	}

	it("counts an untagged order toward a rule without tags", async () => {
		const { engine, redis, bucket } = createEngine([baseRule({ maxOrders: 2 })]);
		const now = Date.now();

		await seedLegacyOrder(redis, bucket, new Date(now - MINUTE_MS));
		await engine.add(makeOrder({ orderTime: new Date(now) }));

		expect(await engine.getBusyTimes()).to.have.length(1);
	});

	it("does not count an untagged order toward a rule with tags", async () => {
		const { engine, redis, bucket } = createEngine([baseRule({ tags: ["pickup"], maxOrders: 2 })]);
		const now = Date.now();

		await seedLegacyOrder(redis, bucket, new Date(now - MINUTE_MS));
		await engine.add(makeOrder({ orderTime: new Date(now) }));

		expect(await engine.getBusyTimes()).to.have.length(0);
	});

	it("delays every order kind for a window without a scope", async () => {
		const { engine, redis, bucket } = createEngine([]);
		const now = Date.now();
		const end = new Date(now + 10 * MINUTE_MS);

		await seedBusyTime(redis, bucket, { start: new Date(now - 5 * MINUTE_MS), end, scope: [] });

		for (const order of ORDER_KINDS) {
			const { waitPeriodSeconds } = await engine.validateOrderTime({
				orderTime: new Date(now),
				tags: orderTags(order),
			});

			expect(waitPeriodSeconds, describeOrder(order)).to.equal(toSeconds(end) + 1 - toSeconds(now));
		}
	});

	it("delays an order checked without tags only by windows without a scope", async () => {
		const { engine, redis, bucket } = createEngine([]);
		const now = Date.now();

		await seedBusyTime(redis, bucket, {
			start: new Date(now - 5 * MINUTE_MS),
			end: new Date(now + 10 * MINUTE_MS),
			scope: ["pickup"],
		});

		expect(await engine.validateOrderTime({ orderTime: new Date(now) })).to.deep.equal({
			waitPeriodSeconds: 0,
			ordersInWindow: 0,
		});
	});
});

describe("matchesTags edge cases", () => {
	it("does not care about the order of tags on either side", () => {
		expect(matchesTags(["catering", "delivery"], ["delivery", "catering"])).to.equal(true);
		expect(matchesTags([["curbside", "delivery"]], ["delivery"])).to.equal(true);
	});

	it("ignores extra tags on the order", () => {
		expect(matchesTags(["delivery"], ["delivery", "catering", "vip"])).to.equal(true);
	});

	it("treats a one-tag list the same as the plain tag", () => {
		for (const tags of [["delivery"], ["pickup"], []]) {
			expect(matchesTags([["delivery"]], tags)).to.equal(matchesTags(["delivery"], tags));
		}
	});

	it("needs a match in every list when a rule has several", () => {
		const rule: RuleTag[] = [
			["pickup", "delivery"],
			["catering", "vip"],
		];

		expect(matchesTags(rule, ["delivery", "vip"])).to.equal(true);
		expect(matchesTags(rule, ["pickup", "catering"])).to.equal(true);
		expect(matchesTags(rule, ["delivery", "non-catering"])).to.equal(false);
		expect(matchesTags(rule, ["curbside", "catering"])).to.equal(false);
	});

	it("matches tags case-sensitively", () => {
		expect(matchesTags(["delivery"], ["Delivery"])).to.equal(false);
	});

	it("does not match an untagged order against any tag", () => {
		expect(matchesTags(["pickup"], [])).to.equal(false);
		expect(matchesTags([["pickup", "delivery"]], [])).to.equal(false);
		expect(matchesTags([], [])).to.equal(true);
	});

	it("does not treat a repeated rule tag as needing it twice", () => {
		expect(matchesTags(["delivery", "delivery"], ["delivery"])).to.equal(true);
	});
});
