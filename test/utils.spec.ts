import { expect } from "chai";
import { describe, it } from "mocha";
import { matchesCategories, matchesTags, secondsToDate, timeStringToMinutes, toSeconds } from "../src/utils";

describe("toSeconds", () => {
	it("should convert Date object to seconds", () => {
		const date = new Date("2024-01-01T12:00:00Z");
		expect(toSeconds(date)).to.equal(Math.floor(date.getTime() / 1000));
	});

	it("should convert timestamp number to seconds", () => {
		expect(toSeconds(1704110400000)).to.equal(1704110400);
	});

	it("should handle current time", () => {
		const now = new Date();
		expect(toSeconds(now)).to.equal(Math.floor(now.getTime() / 1000));
	});

	it("should handle Date.now() directly", () => {
		const now = Date.now();
		expect(toSeconds(now)).to.equal(Math.floor(now / 1000));
	});

	it("should floor fractional seconds correctly", () => {
		expect(toSeconds(1704110400123)).to.equal(1704110400);
	});

	it("should handle zero timestamp", () => {
		expect(toSeconds(0)).to.equal(0);
		expect(toSeconds(new Date(0))).to.equal(0);
	});

	it("should handle negative timestamps", () => {
		expect(toSeconds(-1000)).to.equal(-1);
	});

	it("should handle very large timestamps", () => {
		expect(toSeconds(9999999999999)).to.equal(9999999999);
	});
});

describe("secondsToDate", () => {
	it("should convert seconds to Date object", () => {
		const seconds = 1704110400;
		const expected = new Date("2024-01-01T12:00:00Z");
		expect(secondsToDate(seconds).getTime()).to.equal(expected.getTime());
	});

	it("should handle zero seconds", () => {
		expect(secondsToDate(0).getTime()).to.equal(new Date(0).getTime());
	});

	it("should handle current time seconds", () => {
		const now = Date.now();
		const seconds = Math.floor(now / 1000);
		const result = secondsToDate(seconds);
		expect(Math.abs(result.getTime() - now)).to.be.lessThan(1000);
	});

	it("should handle negative seconds", () => {
		expect(secondsToDate(-1000).getTime()).to.equal(new Date(-1000 * 1000).getTime());
	});
});

describe("timeStringToMinutes", () => {
	it("should convert time string to minutes", () => {
		expect(timeStringToMinutes("00:00")).to.equal(0);
		expect(timeStringToMinutes("01:00")).to.equal(60);
		expect(timeStringToMinutes("12:30")).to.equal(750);
		expect(timeStringToMinutes("23:59")).to.equal(1439);
	});

	it("should handle single digit hours and minutes", () => {
		expect(timeStringToMinutes("1:5")).to.equal(65);
		expect(timeStringToMinutes("9:9")).to.equal(549);
	});

	it("should handle midnight", () => {
		expect(timeStringToMinutes("00:00")).to.equal(0);
		expect(timeStringToMinutes("0:0")).to.equal(0);
	});

	it("should handle noon", () => {
		expect(timeStringToMinutes("12:00")).to.equal(720);
	});

	it("should handle end of day", () => {
		expect(timeStringToMinutes("23:59")).to.equal(1439);
	});

	it("should accept HH:mm:ss but ignore seconds in calculation", () => {
		expect(timeStringToMinutes("00:00:30")).to.equal(0);
		expect(timeStringToMinutes("12:30:30")).to.equal(750);
		expect(timeStringToMinutes("09:30:00")).to.equal(570);
		expect(timeStringToMinutes("23:59:59")).to.equal(1439);
	});
});

describe("matchesCategories", () => {
	it("matches every order when the rule has no categories", () => {
		expect(matchesCategories([], ["sweet"])).to.equal(true);
		expect(matchesCategories([], [])).to.equal(true);
	});

	it("matches an order holding one of the rule's categories", () => {
		expect(matchesCategories(["sweet", "bitter"], ["fancy", "bitter"])).to.equal(true);
	});

	it("does not match an order without the rule's categories", () => {
		expect(matchesCategories(["sweet"], ["fancy"])).to.equal(false);
		expect(matchesCategories(["sweet"], [])).to.equal(false);
	});

	it("matches every rule when the order's categories are not given", () => {
		expect(matchesCategories(["sweet"])).to.equal(true);
		expect(matchesCategories(undefined, undefined)).to.equal(true);
	});
});

describe("matchesTags", () => {
	it("matches every order when the rule has no tags", () => {
		expect(matchesTags([], ["pickup"])).to.equal(true);
	});

	it("needs every plain tag on the order", () => {
		expect(matchesTags(["delivery", "catering"], ["delivery", "catering"])).to.equal(true);
		expect(matchesTags(["delivery", "catering"], ["delivery"])).to.equal(false);
	});

	it("matches a list of tags when the order carries any one of them", () => {
		expect(matchesTags([["delivery", "curbside"]], ["delivery"])).to.equal(true);
		expect(matchesTags([["delivery", "curbside"]], ["curbside"])).to.equal(true);
		expect(matchesTags([["delivery", "curbside"]], ["pickup"])).to.equal(false);
	});

	it("needs a list and every plain tag together", () => {
		expect(matchesTags([["delivery", "curbside"], "catering"], ["curbside", "catering"])).to.equal(true);
		expect(matchesTags([["delivery", "curbside"], "catering"], ["curbside", "non-catering"])).to.equal(false);
	});
});
