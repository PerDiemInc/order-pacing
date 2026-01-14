import { expect } from "chai";
import { describe, it } from "mocha";
import {
	minutesToSeconds,
	secondsToDate,
	secondsToMinutes,
	timeStringToMinutes,
	toSeconds,
} from "../src/utils";

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
		expect(secondsToDate(-1000).getTime()).to.equal(
			new Date(-1000 * 1000).getTime(),
		);
	});
});

describe("minutesToSeconds", () => {
	it("should convert minutes to seconds", () => {
		expect(minutesToSeconds(1)).to.equal(60);
		expect(minutesToSeconds(5)).to.equal(300);
		expect(minutesToSeconds(60)).to.equal(3600);
	});

	it("should handle zero minutes", () => {
		expect(minutesToSeconds(0)).to.equal(0);
	});

	it("should handle fractional minutes", () => {
		expect(minutesToSeconds(0.5)).to.equal(30);
		expect(minutesToSeconds(1.5)).to.equal(90);
	});

	it("should handle negative minutes", () => {
		expect(minutesToSeconds(-1)).to.equal(-60);
	});
});

describe("secondsToMinutes", () => {
	it("should convert seconds to minutes", () => {
		expect(secondsToMinutes(60)).to.equal(1);
		expect(secondsToMinutes(300)).to.equal(5);
		expect(secondsToMinutes(3600)).to.equal(60);
	});

	it("should handle zero seconds", () => {
		expect(secondsToMinutes(0)).to.equal(0);
	});

	it("should ceil fractional results", () => {
		expect(secondsToMinutes(30)).to.equal(1);
		expect(secondsToMinutes(90)).to.equal(2);
		expect(secondsToMinutes(31)).to.equal(1);
		expect(secondsToMinutes(59)).to.equal(1);
	});

	it("should handle negative seconds", () => {
		expect(secondsToMinutes(-60)).to.equal(-1);
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
});
