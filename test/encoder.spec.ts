import { expect } from "chai";
import { describe, it } from "mocha";
import {
	decodeBusyTime,
	decodeOrder,
	encodeBusyTime,
	encodeOrder,
} from "../src/encoder";
import type { BusyTime, Order } from "../src/engine/types";
import { OrderSource } from "../src/engine/types";

function generateOrderTestCases(): Order[] {
	const baseDate = new Date("2024-01-01T12:00:00Z");
	const baseTimeSeconds = 1704110400;

	return [
		{
			orderId: "order-1",
			items: [
				{
					itemId: "item-1",
					quantity: 2,
					totalAmountCents: 2100,
					categoryId: "cat-1",
				},
			],
			totalAmountCents: 2100,
			source: OrderSource.PERDIEM,
			orderTime: baseDate,
			orderTimeSeconds: baseTimeSeconds,
			currentTimeSeconds: baseTimeSeconds,
		},
		{
			orderId: "order-2",
			items: [
				{
					itemId: "item-1",
					quantity: 1,
					totalAmountCents: 1000,
					categoryId: null,
				},
			],
			totalAmountCents: 1000,
			source: OrderSource.PERDIEM,
			orderTime: baseDate,
			orderTimeSeconds: baseTimeSeconds,
			currentTimeSeconds: baseTimeSeconds,
		},
		{
			orderId: "order-3",
			items: [
				{
					itemId: "item-1",
					quantity: 1,
					totalAmountCents: 1000,
					categoryId: "cat-1",
				},
				{
					itemId: "item-2",
					quantity: 3,
					totalAmountCents: 4500,
					categoryId: "cat-2",
				},
			],
			totalAmountCents: 5500,
			source: OrderSource.OTHER,
			orderTime: baseDate,
			orderTimeSeconds: baseTimeSeconds,
			currentTimeSeconds: baseTimeSeconds,
		},
		{
			orderId: "order-4",
			items: [
				{
					itemId: "item-1",
					quantity: 5,
					totalAmountCents: 10495,
					categoryId: "cat-1",
				},
				{
					itemId: "item-2",
					quantity: 2,
					totalAmountCents: 3100,
					categoryId: null,
				},
			],
			totalAmountCents: 13595,
			source: OrderSource.PERDIEM,
			orderTime: baseDate,
			orderTimeSeconds: baseTimeSeconds,
			currentTimeSeconds: baseTimeSeconds,
		},
		{
			orderId: "order-5",
			items: [],
			totalAmountCents: 0,
			source: OrderSource.PERDIEM,
			orderTime: baseDate,
			orderTimeSeconds: baseTimeSeconds,
			currentTimeSeconds: baseTimeSeconds,
		},
		{
			orderId: "order-6",
			items: [
				{
					itemId: "item-1",
					quantity: 100,
					totalAmountCents: 100000,
					categoryId: "cat-1",
				},
			],
			totalAmountCents: 100000,
			source: OrderSource.OTHER,
			orderTime: new Date("2024-06-15T14:30:00Z"),
			orderTimeSeconds: 1718464200,
			currentTimeSeconds: 1718464200,
		},
		{
			orderId: "order-7",
			items: [
				{
					itemId: "item-1",
					quantity: 0,
					totalAmountCents: 0,
					categoryId: null,
				},
			],
			totalAmountCents: 0,
			source: OrderSource.PERDIEM,
			orderTime: baseDate,
			orderTimeSeconds: 0,
			currentTimeSeconds: 0,
		},
	];
}

function generateBusyTimeTestCases(): BusyTime[] {
	return [
		{
			startTime: new Date("2024-01-01T12:00:00Z"),
			endTime: new Date("2024-01-01T12:15:00Z"),
			orderTimeSeconds: 1704110400,
			currentTimeSeconds: 1704110400,
			busyTimeSeconds: 900,
			busyTimeContext: {
				totalAmountCents: 5000,
				totalItems: 10,
				totalOrders: 2,
				categoryIds: ["cat-1"],
			},
			threshold: {
				type: "items",
				value: 10,
				limit: 5,
				categoryIds: ["cat-1"],
			},
		},
		{
			startTime: new Date(0),
			endTime: new Date(0),
			orderTimeSeconds: 0,
			currentTimeSeconds: 0,
			busyTimeSeconds: 0,
			busyTimeContext: {
				totalAmountCents: 0,
				totalItems: 0,
				totalOrders: 0,
				categoryIds: [],
			},
			threshold: {
				type: "orders",
				value: 0,
				limit: 0,
				categoryIds: [],
			},
		},
		{
			startTime: new Date("2024-06-15T14:25:00Z"),
			endTime: new Date("2024-06-15T14:40:00Z"),
			orderTimeSeconds: 1718464200,
			currentTimeSeconds: 1718463900,
			busyTimeSeconds: 1800,
			busyTimeContext: {
				totalAmountCents: 50000,
				totalItems: 20,
				totalOrders: 5,
				categoryIds: ["cat-1", "cat-2"],
			},
			threshold: {
				type: "orders",
				value: 5,
				limit: 3,
				categoryIds: ["cat-1", "cat-2"],
			},
		},
		{
			startTime: new Date("2024-06-15T14:25:00Z"),
			endTime: new Date("2024-06-15T14:40:00Z"),
			orderTimeSeconds: 1718464200,
			currentTimeSeconds: 1718463900,
			busyTimeSeconds: 1800,
			busyTimeContext: {
				totalAmountCents: 50000,
				totalItems: 20,
				totalOrders: 5,
				categoryIds: ["cat-1", "cat-2"],
			},
			threshold: {
				type: "amount",
				value: 50000,
				limit: 40000,
				categoryIds: ["cat-1", "cat-2"],
			},
		},
		{
			startTime: new Date("2024-01-01T12:00:00Z"),
			endTime: new Date("2024-01-01T12:15:00Z"),
			orderTimeSeconds: 1704110400,
			currentTimeSeconds: 1704110400,
			busyTimeSeconds: 900,
			busyTimeContext: {
				totalAmountCents: 5000,
				totalItems: 10,
				totalOrders: 2,
				categoryIds: [],
			},
			threshold: {
				type: "items",
				value: 10,
				limit: 5,
				categoryIds: [],
			},
		},
	];
}

describe("encodeOrder / decodeOrder", () => {
	const testCases = generateOrderTestCases();

	testCases.forEach((order, index) => {
		it(`should round-trip encode/decode order case ${index + 1}`, () => {
			const decoded = decodeOrder(encodeOrder(order));

			expect(decoded.orderId).to.equal(order.orderId);
			expect(decoded.items).to.deep.equal(order.items);
			expect(decoded.totalAmountCents).to.equal(order.totalAmountCents);
			expect(decoded.source).to.equal(order.source);
			expect(decoded.orderTime.getTime()).to.equal(order.orderTime.getTime());
			expect(decoded.orderTimeSeconds).to.equal(order.orderTimeSeconds);
			expect(decoded.currentTimeSeconds).to.equal(order.currentTimeSeconds);
		});
	});
});

describe("encodeBusyTime / decodeBusyTime", () => {
	const testCases = generateBusyTimeTestCases();

	testCases.forEach((busyTime, index) => {
		it(`should round-trip encode/decode busy time case ${index + 1}`, () => {
			const decoded = decodeBusyTime(encodeBusyTime(busyTime));

			expect(decoded.startTime.getTime()).to.equal(
				busyTime.startTime.getTime(),
			);
			expect(decoded.endTime.getTime()).to.equal(busyTime.endTime.getTime());
			expect(decoded.orderTimeSeconds).to.equal(busyTime.orderTimeSeconds);
			expect(decoded.currentTimeSeconds).to.equal(busyTime.currentTimeSeconds);
			expect(decoded.busyTimeSeconds).to.equal(busyTime.busyTimeSeconds);
			expect(decoded.busyTimeContext).to.deep.equal(busyTime.busyTimeContext);
			expect(decoded.threshold).to.deep.equal(busyTime.threshold);
		});
	});
});
