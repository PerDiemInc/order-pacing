import { expect } from "chai";
import { describe, it } from "mocha";
import {
	minutesToSeconds,
	scoreToDate,
	secondsToMinutes,
	toSeconds,
} from "../src/utils";

describe("toSeconds", () => {
	it("should convert Date object to seconds", () => {
		const date = new Date("2024-01-01T12:00:00Z");
		const expectedSeconds = Math.floor(date.getTime() / 1000);
		expect(toSeconds(date)).to.equal(expectedSeconds);
	});

	it("should convert timestamp number to seconds", () => {
		const timestamp = 1704110400000;
		const expectedSeconds = 1704110400;
		expect(toSeconds(timestamp)).to.equal(expectedSeconds);
	});

	it("should handle current time", () => {
		const now = new Date();
		const expectedSeconds = Math.floor(now.getTime() / 1000);
		expect(toSeconds(now)).to.equal(expectedSeconds);
	});

	it("should handle Date.now() directly", () => {
		const now = Date.now();
		const expectedSeconds = Math.floor(now / 1000);
		expect(toSeconds(now)).to.equal(expectedSeconds);
	});

	it("should floor fractional seconds correctly", () => {
		const timestamp = 1704110400123;
		const expectedSeconds = 1704110400;
		expect(toSeconds(timestamp)).to.equal(expectedSeconds);
	});

	it("should handle zero timestamp", () => {
		expect(toSeconds(0)).to.equal(0);
		expect(toSeconds(new Date(0))).to.equal(0);
	});

	it("should handle negative timestamps", () => {
		const negativeTimestamp = -1000;
		expect(toSeconds(negativeTimestamp)).to.equal(-1);
	});

	it("should handle very large timestamps", () => {
		const largeTimestamp = 9999999999999;
		const expectedSeconds = 9999999999;
		expect(toSeconds(largeTimestamp)).to.equal(expectedSeconds);
	});
});

describe("scoreToDate", () => {
	it("should convert Redis score (seconds) to Date object", () => {
		const score = 1704110400;
		const expectedDate = new Date("2024-01-01T12:00:00Z");
		expect(scoreToDate(score).getTime()).to.equal(expectedDate.getTime());
	});

	it("should handle zero score", () => {
		const score = 0;
		const expectedDate = new Date(0);
		expect(scoreToDate(score).getTime()).to.equal(expectedDate.getTime());
	});

	it("should handle current time score", () => {
		const now = Date.now();
		const score = Math.floor(now / 1000);
		const result = scoreToDate(score);
		expect(Math.abs(result.getTime() - now)).to.be.lessThan(1000);
	});

	it("should handle negative scores", () => {
		const score = -1000;
		const expectedDate = new Date(-1000 * 1000);
		expect(scoreToDate(score).getTime()).to.equal(expectedDate.getTime());
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
