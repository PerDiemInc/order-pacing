import { expect } from "chai";
import type Redis from "ioredis";
import RedisMock from "ioredis-mock";
import { Packr } from "msgpackr";
import { decodeBusyTime, decodeOrder, encodeBusyTime, encodeOrder } from "../src/encoder";
import { Engine } from "../src/engine";
import type { BusyTime, Order } from "../src/engine/types";
import { OrderSource } from "../src/engine/types";
import { defaultRuleSet } from "../src/rules";
import { RuleSet } from "../src/rules/RuleSet";
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

const invalid = <T>(value: unknown) => value as T;

describe("defaultRuleSet.validate field by field", () => {
	const accepted: { name: string; rule: Rule }[] = [
		{ name: "busyTimeMinutes of exactly 5", rule: baseRule({ busyTimeMinutes: 5 }) },
		{ name: "a fractional timeFrameMinutes", rule: baseRule({ timeFrameMinutes: 0.5 }) },
		{ name: "only maxItems", rule: baseRule({ maxOrders: undefined, maxItems: 1 }) },
		{ name: "only maxAmountCents", rule: baseRule({ maxOrders: undefined, maxAmountCents: 1 }) },
		{ name: "every threshold", rule: baseRule({ maxOrders: 1, maxItems: 1, maxAmountCents: 1 }) },
		{ name: "every week day", rule: baseRule({ weekDays: [0, 1, 2, 3, 4, 5, 6] }) },
		{ name: "an empty tag list", rule: baseRule({ tags: [] }) },
		{
			name: "the worker's catering tags",
			rule: baseRule({ tags: [["pickup", "delivery", "curbside"], "non-catering"] }),
		},
		{ name: "only a startTime", rule: baseRule({ startTime: "11:00" }) },
		{ name: "only an endTime", rule: baseRule({ endTime: "14:00" }) },
		{ name: "a day-long range with seconds", rule: baseRule({ startTime: "00:00:00", endTime: "23:59:59" }) },
		{ name: "a range one minute long", rule: baseRule({ startTime: "11:00", endTime: "11:01" }) },
		{ name: "categoryIds with entries", rule: baseRule({ categoryIds: ["sweet", "fancy"] }) },
	];

	for (const { name, rule } of accepted) {
		it(`accepts ${name}`, () => {
			expect(() => defaultRuleSet.validate(rule)).to.not.throw();
		});
	}

	const rejected: { name: string; rule: Rule; message: RegExp }[] = [
		{ name: "a non-string ruleId", rule: baseRule({ ruleId: invalid(42) }), message: /ruleId/ },
		{ name: "an empty ruleId", rule: baseRule({ ruleId: "" }), message: /ruleId/ },
		{
			name: "a string timeFrameMinutes",
			rule: baseRule({ timeFrameMinutes: invalid("30") }),
			message: /timeFrameMinutes/,
		},
		{ name: "a negative timeFrameMinutes", rule: baseRule({ timeFrameMinutes: -5 }), message: /timeFrameMinutes/ },
		{
			name: "a missing busyTimeMinutes",
			rule: baseRule({ busyTimeMinutes: invalid(undefined) }),
			message: /busyTimeMinutes/,
		},
		{ name: "busyTimeMinutes just under 5", rule: baseRule({ busyTimeMinutes: 4.99 }), message: /busyTimeMinutes/ },
		{
			name: "a string busyTimeMinutes",
			rule: baseRule({ busyTimeMinutes: invalid("15") }),
			message: /busyTimeMinutes/,
		},
		{ name: "a string maxOrders", rule: baseRule({ maxOrders: invalid("3") }), message: /maxOrders/ },
		{ name: "a negative maxOrders", rule: baseRule({ maxOrders: -1 }), message: /maxOrders/ },
		{ name: "a zero maxItems", rule: baseRule({ maxItems: 0 }), message: /maxItems/ },
		{ name: "a string maxItems", rule: baseRule({ maxItems: invalid("2") }), message: /maxItems/ },
		{ name: "a negative maxAmountCents", rule: baseRule({ maxAmountCents: -100 }), message: /maxAmountCents/ },
		{ name: "a string maxAmountCents", rule: baseRule({ maxAmountCents: invalid("100") }), message: /maxAmountCents/ },
		{ name: "a negative week day", rule: baseRule({ weekDays: [-1] }), message: /weekDays/ },
		{ name: "a string week day", rule: baseRule({ weekDays: invalid(["1"]) }), message: /weekDays/ },
		{ name: "a numeric tag", rule: baseRule({ tags: invalid([1]) }), message: /tags/ },
		{ name: "a whitespace tag", rule: baseRule({ tags: ["  "] }), message: /tags/ },
		{ name: "a whitespace tag in a list", rule: baseRule({ tags: [["pickup", " "]] }), message: /tags/ },
		{ name: "a nested list of tags", rule: baseRule({ tags: invalid([[["pickup"]]]) }), message: /tags/ },
		{
			name: "a non-string startTime",
			rule: baseRule({ startTime: invalid(900) }),
			message: /startTime must be a string/,
		},
		{ name: "a non-string endTime", rule: baseRule({ endTime: invalid(1700) }), message: /endTime must be a string/ },
		{ name: "a malformed endTime", rule: baseRule({ endTime: "5pm" }), message: /endTime must be in HH:mm/ },
		{ name: "an hour past 23", rule: baseRule({ startTime: "24:00" }), message: /startTime must be in HH:mm/ },
		{
			name: "equal startTime and endTime",
			rule: baseRule({ startTime: "11:00", endTime: "11:00" }),
			message: /less than/,
		},
		{
			name: "no thresholds when categoryIds are set",
			rule: baseRule({ maxOrders: undefined, categoryIds: ["sweet"] }),
			message: /At least one threshold/,
		},
	];

	for (const { name, rule, message } of rejected) {
		it(`rejects ${name}`, () => {
			expect(() => defaultRuleSet.validate(rule)).to.throw(message);
		});
	}

	it("rejects an undefined rule", () => {
		expect(() => defaultRuleSet.validate(invalid<Rule>(undefined))).to.throw(/null or undefined/);
	});
});

describe("RuleSet", () => {
	it("runs its validators in order and stops at the first failure", () => {
		const calls: string[] = [];
		const ruleSet = new RuleSet(
			() => {
				calls.push("first");
			},
			() => {
				calls.push("second");
				throw new Error("second failed");
			},
			() => {
				calls.push("third");
			},
		);

		expect(() => ruleSet.validate(baseRule())).to.throw("second failed");
		expect(calls).to.deep.equal(["first", "second"]);
	});

	it("accepts any rule when it has no validators", () => {
		expect(() => new RuleSet().validate(invalid<Rule>({}))).to.not.throw();
	});
});

describe("Engine constructor rule validation", () => {
	const redis = new RedisMock() as unknown as Redis;

	it("names the rule and the reason", () => {
		expect(() => new Engine({ bucket: "b", redis, rules: [baseRule({ ruleId: "slot-9", maxOrders: 0 })] })).to.throw(
			'Invalid rule "slot-9": maxOrders must be a positive number greater than 0',
		);
	});

	it("rejects a null rule in the list", () => {
		expect(() => new Engine({ bucket: "b", redis, rules: [invalid<Rule>(null)] })).to.throw(
			'Invalid rule "undefined": Rule cannot be null or undefined',
		);
	});

	it("accepts no rules", () => {
		expect(() => new Engine({ bucket: "b", redis })).to.not.throw();
	});
});

describe("encoder defaults", () => {
	const packr = new Packr({ useRecords: true, useTimestamp32: true });
	const orderTime = new Date("2026-01-21T13:44:07.000Z");

	it("fills in missing order fields", () => {
		const order = invalid<Order>({ orderId: "order-1", source: OrderSource.PERDIEM, orderTime });

		expect(decodeOrder(encodeOrder(order))).to.deep.include({
			orderId: "order-1",
			items: [],
			totalAmountCents: 0,
			tags: [],
			orderTimeSeconds: 0,
			currentTimeSeconds: 0,
		});
	});

	it("fills in missing item fields", () => {
		const order = invalid<Order>({
			orderId: "order-1",
			source: OrderSource.PERDIEM,
			orderTime,
			items: [{ itemId: "item-1" }],
		});

		expect(decodeOrder(encodeOrder(order)).items).to.deep.equal([
			{ itemId: "item-1", quantity: 1, totalAmountCents: 0, categoryId: null },
		]);
	});

	it("keeps the source of OTHER orders and reads an unknown source as OTHER", () => {
		const other = invalid<Order>({ orderId: "order-1", source: OrderSource.OTHER, orderTime });
		const unknown = packr.pack({ id: "order-2", is: [], ta: 0, s: "X", ot: orderTime, ots: 0, cts: 0 });

		expect(decodeOrder(encodeOrder(other)).source).to.equal(OrderSource.OTHER);
		expect(decodeOrder(unknown).source).to.equal(OrderSource.OTHER);
	});

	it("keeps orderTime to the second", () => {
		const order = invalid<Order>({
			orderId: "order-1",
			source: OrderSource.PERDIEM,
			orderTime: new Date("2026-01-21T13:44:07.891Z"),
		});

		expect(decodeOrder(encodeOrder(order)).orderTime.toISOString()).to.equal("2026-01-21T13:44:07.000Z");
	});

	it("fills in missing busy time fields", () => {
		const busyTime = invalid<BusyTime>({
			busyTimeId: "busy-1",
			ruleId: "rule-1",
			startTime: orderTime,
			endTime: orderTime,
			orderTimeSeconds: 0,
			currentTimeSeconds: 0,
			busyTimeSeconds: 900,
			busyTimeContext: {},
			threshold: { type: "items" },
		});

		const decoded = decodeBusyTime(encodeBusyTime(busyTime));

		expect(decoded.scope).to.deep.equal([]);
		expect(decoded.busyTimeContext).to.deep.equal({
			totalAmountCents: 0,
			totalItems: 0,
			totalOrders: 0,
			categoryIds: [],
		});
		expect(decoded.threshold).to.deep.equal({ type: "items", value: 0, limit: 0, categoryIds: [] });
	});
});
