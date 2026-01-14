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

describe("encodeOrder", () => {
	it("should encode order with all fields", () => {
		const order: Order = {
			orderId: "order-123",
			items: [
				{
					itemId: "item-1",
					categoryId: "cat-1",
					quantity: 2,
					totalAmountCents: 2100,
				},
			],
			totalAmountCents: 2100,
			source: OrderSource.PERDIEM,
			orderTime: new Date("2024-01-01T12:00:00Z"),
			orderTimeSeconds: 1704110400,
			currentTimeSeconds: 1704110400,
		};
		const buffer = encodeOrder(order);
		expect(buffer).to.be.instanceOf(Buffer);
		expect(buffer.length).to.be.greaterThan(0);
	});

	it("should encode order with multiple items", () => {
		const order: Order = {
			orderId: "order-456",
			items: [
				{
					itemId: "item-1",
					categoryId: "cat-1",
					quantity: 1,
					totalAmountCents: 1000,
				},
				{
					itemId: "item-2",
					categoryId: "cat-2",
					quantity: 3,
					totalAmountCents: 4500,
				},
			],
			totalAmountCents: 5500,
			source: OrderSource.OTHER,
			orderTime: new Date("2024-01-01T12:00:00Z"),
			orderTimeSeconds: 1704110400,
			currentTimeSeconds: 1704110400,
		};
		const buffer = encodeOrder(order);
		expect(buffer).to.be.instanceOf(Buffer);
	});

	it("should encode order with empty items array", () => {
		const order: Order = {
			orderId: "order-empty",
			items: [],
			totalAmountCents: 0,
			source: OrderSource.PERDIEM,
			orderTime: new Date("2024-01-01T12:00:00Z"),
			orderTimeSeconds: 1704110400,
			currentTimeSeconds: 1704110400,
		};
		const buffer = encodeOrder(order);
		expect(buffer).to.be.instanceOf(Buffer);
	});
});

describe("decodeOrder", () => {
	it("should decode order with all fields", () => {
		const order: Order = {
			orderId: "order-123",
			items: [
				{
					itemId: "item-1",
					categoryId: "cat-1",
					quantity: 2,
					totalAmountCents: 2100,
				},
			],
			totalAmountCents: 2100,
			source: OrderSource.PERDIEM,
			orderTime: new Date("2024-01-01T12:00:00Z"),
			orderTimeSeconds: 1704110400,
			currentTimeSeconds: 1704110400,
		};
		const decoded = decodeOrder(encodeOrder(order));

		expect(decoded.orderId).to.equal(order.orderId);
		expect(decoded.items).to.have.lengthOf(1);
		expect(decoded.items[0].itemId).to.equal(order.items[0].itemId);
		expect(decoded.items[0].categoryId).to.equal(order.items[0].categoryId);
		expect(decoded.items[0].quantity).to.equal(order.items[0].quantity);
		expect(decoded.items[0].totalAmountCents).to.equal(
			order.items[0].totalAmountCents,
		);
		expect(decoded.totalAmountCents).to.equal(order.totalAmountCents);
		expect(decoded.source).to.equal(order.source);
		expect(decoded.orderTime.getTime()).to.equal(order.orderTime.getTime());
		expect(decoded.orderTimeSeconds).to.equal(order.orderTimeSeconds);
		expect(decoded.currentTimeSeconds).to.equal(order.currentTimeSeconds);
	});

	it("should decode order with multiple items", () => {
		const order: Order = {
			orderId: "order-456",
			items: [
				{
					itemId: "item-1",
					categoryId: "cat-1",
					quantity: 1,
					totalAmountCents: 1000,
				},
				{
					itemId: "item-2",
					categoryId: "cat-2",
					quantity: 3,
					totalAmountCents: 4500,
				},
			],
			totalAmountCents: 5500,
			source: OrderSource.OTHER,
			orderTime: new Date("2024-01-01T12:00:00Z"),
			orderTimeSeconds: 1704110400,
			currentTimeSeconds: 1704110400,
		};
		const decoded = decodeOrder(encodeOrder(order));

		expect(decoded.orderId).to.equal(order.orderId);
		expect(decoded.items).to.have.lengthOf(2);
		expect(decoded.items[0].itemId).to.equal("item-1");
		expect(decoded.items[1].itemId).to.equal("item-2");
		expect(decoded.source).to.equal(OrderSource.OTHER);
	});

	it("should decode order with empty items array", () => {
		const order: Order = {
			orderId: "order-empty",
			items: [],
			totalAmountCents: 0,
			source: OrderSource.PERDIEM,
			orderTime: new Date("2024-01-01T12:00:00Z"),
			orderTimeSeconds: 1704110400,
			currentTimeSeconds: 1704110400,
		};
		const decoded = decodeOrder(encodeOrder(order));

		expect(decoded.orderId).to.equal(order.orderId);
		expect(decoded.items).to.have.lengthOf(0);
		expect(decoded.source).to.equal(OrderSource.PERDIEM);
	});

	it("should handle PERDIEM source correctly", () => {
		const order: Order = {
			orderId: "order-perdiem",
			items: [
				{
					itemId: "item-1",
					categoryId: "cat-1",
					quantity: 1,
					totalAmountCents: 1000,
				},
			],
			totalAmountCents: 1000,
			source: OrderSource.PERDIEM,
			orderTime: new Date("2024-01-01T12:00:00Z"),
			orderTimeSeconds: 1704110400,
			currentTimeSeconds: 1704110400,
		};
		const decoded = decodeOrder(encodeOrder(order));
		expect(decoded.source).to.equal(OrderSource.PERDIEM);
	});

	it("should handle OTHER source correctly", () => {
		const order: Order = {
			orderId: "order-other",
			items: [
				{
					itemId: "item-1",
					categoryId: "cat-1",
					quantity: 1,
					totalAmountCents: 1000,
				},
			],
			totalAmountCents: 1000,
			source: OrderSource.OTHER,
			orderTime: new Date("2024-01-01T12:00:00Z"),
			orderTimeSeconds: 1704110400,
			currentTimeSeconds: 1704110400,
		};
		const decoded = decodeOrder(encodeOrder(order));
		expect(decoded.source).to.equal(OrderSource.OTHER);
	});
});

describe("encodeBusyTime", () => {
	it("should encode busy time with all fields", () => {
		const busyTime: BusyTime = {
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
		};
		const buffer = encodeBusyTime(busyTime);
		expect(buffer).to.be.instanceOf(Buffer);
		expect(buffer.length).to.be.greaterThan(0);
	});

	it("should encode busy time with zero values", () => {
		const busyTime: BusyTime = {
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
		};
		const buffer = encodeBusyTime(busyTime);
		expect(buffer).to.be.instanceOf(Buffer);
	});
});

describe("decodeBusyTime", () => {
	it("should decode busy time with all fields", () => {
		const busyTime: BusyTime = {
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
		};
		const decoded = decodeBusyTime(encodeBusyTime(busyTime));

		expect(decoded.startTime.getTime()).to.equal(busyTime.startTime.getTime());
		expect(decoded.endTime.getTime()).to.equal(busyTime.endTime.getTime());
		expect(decoded.orderTimeSeconds).to.equal(busyTime.orderTimeSeconds);
		expect(decoded.currentTimeSeconds).to.equal(busyTime.currentTimeSeconds);
		expect(decoded.busyTimeSeconds).to.equal(busyTime.busyTimeSeconds);
		expect(decoded.threshold.type).to.equal(busyTime.threshold.type);
		expect(decoded.threshold.value).to.equal(busyTime.threshold.value);
		expect(decoded.threshold.limit).to.equal(busyTime.threshold.limit);
		expect(decoded.threshold.categoryIds).to.deep.equal(
			busyTime.threshold.categoryIds,
		);
		expect(decoded.busyTimeContext.totalAmountCents).to.equal(
			busyTime.busyTimeContext.totalAmountCents,
		);
		expect(decoded.busyTimeContext.totalItems).to.equal(
			busyTime.busyTimeContext.totalItems,
		);
		expect(decoded.busyTimeContext.totalOrders).to.equal(
			busyTime.busyTimeContext.totalOrders,
		);
		expect(decoded.busyTimeContext.categoryIds).to.deep.equal(
			busyTime.busyTimeContext.categoryIds,
		);
	});

	it("should decode busy time with zero values", () => {
		const busyTime: BusyTime = {
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
		};
		const decoded = decodeBusyTime(encodeBusyTime(busyTime));

		expect(decoded.startTime.getTime()).to.equal(0);
		expect(decoded.endTime.getTime()).to.equal(0);
		expect(decoded.orderTimeSeconds).to.equal(0);
		expect(decoded.currentTimeSeconds).to.equal(0);
		expect(decoded.busyTimeSeconds).to.equal(0);
		expect(decoded.threshold.type).to.equal(busyTime.threshold.type);
		expect(decoded.threshold.value).to.equal(busyTime.threshold.value);
		expect(decoded.threshold.limit).to.equal(busyTime.threshold.limit);
		expect(decoded.threshold.categoryIds).to.deep.equal(
			busyTime.threshold.categoryIds,
		);
		expect(decoded.busyTimeContext.totalAmountCents).to.equal(0);
		expect(decoded.busyTimeContext.totalItems).to.equal(0);
		expect(decoded.busyTimeContext.totalOrders).to.equal(0);
		expect(decoded.busyTimeContext.categoryIds).to.deep.equal([]);
	});
});

describe("round-trip encoding", () => {
	it("should maintain data integrity for order through encode/decode cycle", () => {
		const original: Order = {
			orderId: "order-roundtrip",
			items: [
				{
					itemId: "item-1",
					categoryId: "cat-1",
					quantity: 5,
					totalAmountCents: 10495,
				},
				{
					itemId: "item-2",
					categoryId: "cat-2",
					quantity: 2,
					totalAmountCents: 3100,
				},
			],
			totalAmountCents: 134950,
			source: OrderSource.PERDIEM,
			orderTime: new Date("2024-06-15T14:30:00Z"),
			orderTimeSeconds: 1718464200,
			currentTimeSeconds: 1718464200,
		};
		const decoded = decodeOrder(encodeOrder(original));

		expect(decoded.orderId).to.equal(original.orderId);
		expect(decoded.items.length).to.equal(original.items.length);
		expect(decoded.items[0].itemId).to.equal(original.items[0].itemId);
		expect(decoded.items[0].categoryId).to.equal(original.items[0].categoryId);
		expect(decoded.items[0].quantity).to.equal(original.items[0].quantity);
		expect(decoded.items[0].totalAmountCents).to.equal(
			original.items[0].totalAmountCents,
		);
		expect(decoded.items[1].itemId).to.equal(original.items[1].itemId);
		expect(decoded.items[1].categoryId).to.equal(original.items[1].categoryId);
		expect(decoded.items[1].quantity).to.equal(original.items[1].quantity);
		expect(decoded.items[1].totalAmountCents).to.equal(
			original.items[1].totalAmountCents,
		);
		expect(decoded.totalAmountCents).to.equal(original.totalAmountCents);
		expect(decoded.source).to.equal(original.source);
		expect(decoded.orderTime.getTime()).to.equal(original.orderTime.getTime());
		expect(decoded.orderTimeSeconds).to.equal(original.orderTimeSeconds);
		expect(decoded.currentTimeSeconds).to.equal(original.currentTimeSeconds);
	});

	it("should maintain data integrity for busy time through encode/decode cycle", () => {
		const original: BusyTime = {
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
		};
		const decoded = decodeBusyTime(encodeBusyTime(original));

		expect(decoded.startTime.getTime()).to.equal(original.startTime.getTime());
		expect(decoded.endTime.getTime()).to.equal(original.endTime.getTime());
		expect(decoded.orderTimeSeconds).to.equal(original.orderTimeSeconds);
		expect(decoded.currentTimeSeconds).to.equal(original.currentTimeSeconds);
		expect(decoded.busyTimeSeconds).to.equal(original.busyTimeSeconds);
		expect(decoded.threshold.type).to.equal(original.threshold.type);
		expect(decoded.threshold.value).to.equal(original.threshold.value);
		expect(decoded.threshold.limit).to.equal(original.threshold.limit);
		expect(decoded.threshold.categoryIds).to.deep.equal(
			original.threshold.categoryIds,
		);
		expect(decoded.busyTimeContext.totalAmountCents).to.equal(
			original.busyTimeContext.totalAmountCents,
		);
		expect(decoded.busyTimeContext.totalItems).to.equal(
			original.busyTimeContext.totalItems,
		);
		expect(decoded.busyTimeContext.totalOrders).to.equal(
			original.busyTimeContext.totalOrders,
		);
		expect(decoded.busyTimeContext.categoryIds).to.deep.equal(
			original.busyTimeContext.categoryIds,
		);
	});
});
