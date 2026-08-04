import { expect } from "chai";
import EngineRule from "../src/engine/EngineRule";
import type { Order } from "../src/engine/types";
import { OrderSource } from "../src/engine/types";
import { defaultRuleSet } from "../src/rules";
import type { Rule } from "../src/rules/types";

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

// 2026-01-21T13:44:07Z is a Wednesday; 08:44 in America/New_York (EST).
const WEDNESDAY_1344_UTC = new Date("2026-01-21T13:44:07.000Z");

function makeOrder(overrides: Partial<Order> = {}): Order {
	return {
		orderId: "order-1",
		orderTime: WEDNESDAY_1344_UTC,
		orderTimeSeconds: 0,
		currentTimeSeconds: 0,
		totalAmountCents: 1000,
		source: OrderSource.PERDIEM,
		tags: ["pickup"],
		items: [{ itemId: "item-1", quantity: 1, totalAmountCents: 1000, categoryId: null }],
		...overrides,
	};
}

describe("EngineRule.applyCheck", () => {
	it("applies on any day and time when weekDays is empty and no time range is set", () => {
		const engineRule = new EngineRule(baseRule());

		expect(engineRule.applyCheck(makeOrder(), "UTC")).to.equal(true);
	});

	it("applies to all days when weekDays is omitted", () => {
		const rule = baseRule();
		delete rule.weekDays;

		expect(new EngineRule(rule).applyCheck(makeOrder(), "UTC")).to.equal(true);
	});

	it("applies only on configured week days", () => {
		expect(new EngineRule(baseRule({ weekDays: [3] })).applyCheck(makeOrder(), "UTC")).to.equal(true);
		expect(new EngineRule(baseRule({ weekDays: [0, 6] })).applyCheck(makeOrder(), "UTC")).to.equal(false);
	});

	it("evaluates week days and time of day in the configured time zone", () => {
		const rule = baseRule({ startTime: "09:00" });

		expect(new EngineRule(rule).applyCheck(makeOrder(), "UTC")).to.equal(true);
		// 08:44 local in New York, before the 09:00 start.
		expect(new EngineRule(rule).applyCheck(makeOrder(), "America/New_York")).to.equal(false);
	});

	it("applies only to orders matching the rule's tags", () => {
		const deliveryRule = new EngineRule(baseRule({ tags: ["delivery"] }));

		expect(deliveryRule.applyCheck(makeOrder({ tags: ["delivery"] }), "UTC")).to.equal(true);
		expect(deliveryRule.applyCheck(makeOrder(), "UTC")).to.equal(false);

		const cateringRule = new EngineRule(baseRule({ tags: ["catering"] }));

		expect(cateringRule.applyCheck(makeOrder({ tags: ["pickup", "catering"] }), "UTC")).to.equal(true);
		expect(cateringRule.applyCheck(makeOrder(), "UTC")).to.equal(false);
	});

	it("requires all tags to match together", () => {
		const engineRule = new EngineRule(baseRule({ tags: ["delivery", "catering"], weekDays: [3] }));

		expect(engineRule.applyCheck(makeOrder({ tags: ["delivery", "catering"] }), "UTC")).to.equal(true);
		expect(engineRule.applyCheck(makeOrder({ tags: ["delivery"] }), "UTC")).to.equal(false);
		expect(engineRule.applyCheck(makeOrder({ tags: ["pickup", "catering"] }), "UTC")).to.equal(false);
	});

	it("treats startTime and endTime boundaries as inclusive", () => {
		expect(new EngineRule(baseRule({ startTime: "13:44" })).applyCheck(makeOrder(), "UTC")).to.equal(true);
		expect(new EngineRule(baseRule({ endTime: "13:44" })).applyCheck(makeOrder(), "UTC")).to.equal(true);
		expect(new EngineRule(baseRule({ startTime: "13:45" })).applyCheck(makeOrder(), "UTC")).to.equal(false);
		expect(new EngineRule(baseRule({ endTime: "13:43" })).applyCheck(makeOrder(), "UTC")).to.equal(false);
	});
});

describe("EngineRule.thresholdCheck", () => {
	it("returns null when no threshold is reached", () => {
		const engineRule = new EngineRule(baseRule({ maxOrders: 3 }));

		expect(engineRule.thresholdCheck([makeOrder(), makeOrder()])).to.equal(null);
	});

	it("returns null for an empty window", () => {
		expect(new EngineRule(baseRule({ maxOrders: 1 })).thresholdCheck([])).to.equal(null);
	});

	it("counts only orders matching the rule's tags", () => {
		const engineRule = new EngineRule(baseRule({ tags: ["delivery"], maxOrders: 2 }));
		const delivery = makeOrder({ tags: ["delivery"] });

		expect(engineRule.thresholdCheck([makeOrder(), makeOrder(), delivery])).to.equal(null);

		const result = engineRule.thresholdCheck([makeOrder(), delivery, delivery]);

		expect(result?.threshold).to.deep.include({ type: "orders", value: 2, limit: 2 });
	});

	it("counts only catering orders when the catering tag is set", () => {
		const engineRule = new EngineRule(baseRule({ tags: ["catering"], maxOrders: 2 }));
		const catering = makeOrder({ tags: ["pickup", "catering"] });

		expect(engineRule.thresholdCheck([makeOrder(), makeOrder(), catering])).to.equal(null);
		expect(engineRule.thresholdCheck([makeOrder(), catering, catering])?.threshold.type).to.equal("orders");
	});

	it("combines tags and category filters for item counting", () => {
		const engineRule = new EngineRule(
			baseRule({
				tags: ["delivery"],
				categoryIds: ["cat-1"],
				maxOrders: undefined,
				maxItems: 3,
			}),
		);

		const pickup = makeOrder({
			items: [{ itemId: "a", quantity: 5, totalAmountCents: 500, categoryId: "cat-1" }],
		});
		const delivery = makeOrder({
			tags: ["delivery"],
			items: [
				{ itemId: "b", quantity: 2, totalAmountCents: 200, categoryId: "cat-1" },
				{ itemId: "c", quantity: 9, totalAmountCents: 900, categoryId: "cat-2" },
			],
		});

		expect(engineRule.thresholdCheck([pickup, delivery])).to.equal(null);

		const result = engineRule.thresholdCheck([pickup, delivery, delivery]);

		expect(result?.threshold).to.deep.include({ type: "items", value: 4, limit: 3 });
	});

	it("checks maxOrders before maxItems and maxAmountCents", () => {
		const engineRule = new EngineRule(baseRule({ maxOrders: 1, maxItems: 1, maxAmountCents: 1 }));

		const result = engineRule.thresholdCheck([makeOrder()]);

		expect(result?.threshold.type).to.equal("orders");
	});

	it("sums item quantities for maxItems", () => {
		const engineRule = new EngineRule(baseRule({ maxOrders: undefined, maxItems: 5 }));

		const order = makeOrder({
			items: [
				{ itemId: "a", quantity: 2, totalAmountCents: 200, categoryId: null },
				{ itemId: "b", quantity: 3, totalAmountCents: 300, categoryId: null },
			],
		});

		const result = engineRule.thresholdCheck([order]);

		expect(result?.threshold).to.deep.include({ type: "items", value: 5, limit: 5 });
	});

	it("uses order-level totals for maxAmountCents without categories", () => {
		const engineRule = new EngineRule(baseRule({ maxOrders: undefined, maxAmountCents: 3000 }));

		const orders = [makeOrder({ totalAmountCents: 2000 }), makeOrder({ totalAmountCents: 1000 })];

		expect(engineRule.thresholdCheck(orders)?.threshold.type).to.equal("amount");
	});

	it("counts only orders with matching items when categoryIds is set", () => {
		const engineRule = new EngineRule(baseRule({ maxOrders: 2, categoryIds: ["cat-1"] }));

		const matching = makeOrder({
			items: [{ itemId: "a", quantity: 1, totalAmountCents: 100, categoryId: "cat-1" }],
		});
		const nonMatching = makeOrder({
			items: [{ itemId: "b", quantity: 1, totalAmountCents: 100, categoryId: "cat-2" }],
		});

		expect(engineRule.thresholdCheck([matching, nonMatching])).to.equal(null);
		expect(engineRule.thresholdCheck([matching, nonMatching, matching])?.threshold.type).to.equal("orders");
	});

	it("sums only matching item amounts for maxAmountCents with categories", () => {
		const engineRule = new EngineRule(baseRule({ maxOrders: undefined, maxAmountCents: 500, categoryIds: ["cat-1"] }));

		// Order-level total is far over the limit, but only cat-1 item amounts count.
		const order = makeOrder({
			totalAmountCents: 10000,
			items: [
				{ itemId: "a", quantity: 1, totalAmountCents: 300, categoryId: "cat-1" },
				{ itemId: "b", quantity: 1, totalAmountCents: 9700, categoryId: "cat-2" },
			],
		});

		expect(engineRule.thresholdCheck([order])).to.equal(null);

		const secondOrder = makeOrder({
			totalAmountCents: 200,
			items: [{ itemId: "c", quantity: 1, totalAmountCents: 200, categoryId: "cat-1" }],
		});

		const result = engineRule.thresholdCheck([order, secondOrder]);

		expect(result?.threshold).to.deep.include({ type: "amount", value: 500, limit: 500 });
	});

	it("counts all orders when categoryIds is omitted", () => {
		const rule = baseRule({ maxOrders: 2 });
		delete rule.categoryIds;

		const result = new EngineRule(rule).thresholdCheck([makeOrder(), makeOrder()]);

		expect(result?.threshold.type).to.equal("orders");
	});

	it("reports unfiltered window totals in busyTimeContext", () => {
		const engineRule = new EngineRule(baseRule({ maxOrders: 1, categoryIds: ["cat-1"] }));

		const matching = makeOrder({
			totalAmountCents: 100,
			items: [{ itemId: "a", quantity: 1, totalAmountCents: 100, categoryId: "cat-1" }],
		});
		const nonMatching = makeOrder({
			totalAmountCents: 900,
			items: [{ itemId: "b", quantity: 2, totalAmountCents: 900, categoryId: "cat-2" }],
		});

		const result = engineRule.thresholdCheck([matching, nonMatching]);

		expect(result?.busyTimeContext).to.deep.include({
			totalOrders: 2,
			totalItems: 3,
			totalAmountCents: 1000,
		});
	});
});

describe("defaultRuleSet.validate", () => {
	it("accepts a valid rule, including HH:mm:ss times", () => {
		expect(() => defaultRuleSet.validate(baseRule({ startTime: "09:30:15", endTime: "17:00" }))).to.not.throw();
	});

	it("accepts a rule that omits categoryIds and weekDays", () => {
		const rule = baseRule();
		delete rule.categoryIds;
		delete rule.weekDays;

		expect(() => defaultRuleSet.validate(rule)).to.not.throw();
	});

	it("accepts tags filters", () => {
		const rule = baseRule({ tags: ["delivery", "pickup", "catering"] });

		expect(() => defaultRuleSet.validate(rule)).to.not.throw();
	});

	it("rejects non-array categoryIds and weekDays", () => {
		expect(() => defaultRuleSet.validate(baseRule({ categoryIds: "cat-1" as unknown as string[] }))).to.throw(/array/);
		expect(() => defaultRuleSet.validate(baseRule({ weekDays: 3 as unknown as number[] }))).to.throw(/array/);
	});

	const invalidCases: { name: string; rule: Rule }[] = [
		{ name: "empty ruleId", rule: baseRule({ ruleId: " " }) },
		{ name: "zero timeFrameMinutes", rule: baseRule({ timeFrameMinutes: 0 }) },
		{ name: "busyTimeMinutes below 5", rule: baseRule({ busyTimeMinutes: 4 }) },
		{ name: "no thresholds set", rule: baseRule({ maxOrders: undefined }) },
		{ name: "zero maxOrders", rule: baseRule({ maxOrders: 0 }) },
		{ name: "negative maxItems", rule: baseRule({ maxItems: -1 }) },
		{ name: "zero maxAmountCents", rule: baseRule({ maxAmountCents: 0 }) },
		{ name: "out-of-range weekDays", rule: baseRule({ weekDays: [7] }) },
		{ name: "empty tag value", rule: baseRule({ tags: [""] }) },
		{
			name: "non-array tags",
			rule: baseRule({ tags: "delivery" as unknown as string[] }),
		},
		{ name: "malformed startTime", rule: baseRule({ startTime: "9am" }) },
		{ name: "startTime not before endTime", rule: baseRule({ startTime: "17:00", endTime: "09:00" }) },
	];

	for (const { name, rule } of invalidCases) {
		it(`rejects ${name}`, () => {
			expect(() => defaultRuleSet.validate(rule)).to.throw();
		});
	}

	it("rejects a null rule", () => {
		expect(() => defaultRuleSet.validate(null as unknown as Rule)).to.throw();
	});
});
