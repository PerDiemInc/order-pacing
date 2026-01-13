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
					price: 10.5,
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
				{ itemId: "item-1", categoryId: "cat-1", quantity: 1, price: 10 },
				{ itemId: "item-2", categoryId: "cat-2", quantity: 3, price: 15 },
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
					price: 10.5,
				},
			],
			totalAmountCents: 2100,
			source: OrderSource.PERDIEM,
			orderTime: new Date("2024-01-01T12:00:00Z"),
			orderTimeSeconds: 1704110400,
			currentTimeSeconds: 1704110400,
		};

		const buffer = encodeOrder(order);
		const decoded = decodeOrder(buffer);

		expect(decoded.orderId).to.equal(order.orderId);
		expect(decoded.items).to.have.lengthOf(1);
		expect(decoded.items[0].itemId).to.equal(order.items[0].itemId);
		expect(decoded.items[0].categoryId).to.equal(order.items[0].categoryId);
		expect(decoded.items[0].quantity).to.equal(order.items[0].quantity);
		expect(decoded.items[0].price).to.equal(order.items[0].price);
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
				{ itemId: "item-1", categoryId: "cat-1", quantity: 1, price: 10 },
				{ itemId: "item-2", categoryId: "cat-2", quantity: 3, price: 15 },
			],
			totalAmountCents: 5500,
			source: OrderSource.OTHER,
			orderTime: new Date("2024-01-01T12:00:00Z"),
			orderTimeSeconds: 1704110400,
			currentTimeSeconds: 1704110400,
		};

		const buffer = encodeOrder(order);
		const decoded = decodeOrder(buffer);

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

		const buffer = encodeOrder(order);
		const decoded = decodeOrder(buffer);

		expect(decoded.orderId).to.equal(order.orderId);
		expect(decoded.items).to.have.lengthOf(0);
		expect(decoded.source).to.equal(OrderSource.PERDIEM);
	});

	it("should handle PERDIEM source correctly", () => {
		const order: Order = {
			orderId: "order-perdiem",
			items: [
				{ itemId: "item-1", categoryId: "cat-1", quantity: 1, price: 10 },
			],
			totalAmountCents: 1000,
			source: OrderSource.PERDIEM,
			orderTime: new Date("2024-01-01T12:00:00Z"),
			orderTimeSeconds: 1704110400,
			currentTimeSeconds: 1704110400,
		};

		const buffer = encodeOrder(order);
		const decoded = decodeOrder(buffer);

		expect(decoded.source).to.equal(OrderSource.PERDIEM);
	});

	it("should handle OTHER source correctly", () => {
		const order: Order = {
			orderId: "order-other",
			items: [
				{ itemId: "item-1", categoryId: "cat-1", quantity: 1, price: 10 },
			],
			totalAmountCents: 1000,
			source: OrderSource.OTHER,
			orderTime: new Date("2024-01-01T12:00:00Z"),
			orderTimeSeconds: 1704110400,
			currentTimeSeconds: 1704110400,
		};

		const buffer = encodeOrder(order);
		const decoded = decodeOrder(buffer);

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
		};

		const buffer = encodeBusyTime(busyTime);
		const decoded = decodeBusyTime(buffer);

		expect(decoded.startTime.getTime()).to.equal(busyTime.startTime.getTime());
		expect(decoded.endTime.getTime()).to.equal(busyTime.endTime.getTime());
		expect(decoded.orderTimeSeconds).to.equal(busyTime.orderTimeSeconds);
		expect(decoded.currentTimeSeconds).to.equal(busyTime.currentTimeSeconds);
		expect(decoded.busyTimeSeconds).to.equal(busyTime.busyTimeSeconds);
	});

	it("should decode busy time with zero values", () => {
		const busyTime: BusyTime = {
			startTime: new Date(0),
			endTime: new Date(0),
			orderTimeSeconds: 0,
			currentTimeSeconds: 0,
			busyTimeSeconds: 0,
		};

		const buffer = encodeBusyTime(busyTime);
		const decoded = decodeBusyTime(buffer);

		expect(decoded.startTime.getTime()).to.equal(0);
		expect(decoded.endTime.getTime()).to.equal(0);
		expect(decoded.orderTimeSeconds).to.equal(0);
		expect(decoded.currentTimeSeconds).to.equal(0);
		expect(decoded.busyTimeSeconds).to.equal(0);
	});
});

describe("round-trip encoding", () => {
	it("should maintain data integrity for order through encode/decode cycle", () => {
		const original: Order = {
			orderId: "order-roundtrip",
			items: [
				{ itemId: "item-1", categoryId: "cat-1", quantity: 5, price: 20.99 },
				{ itemId: "item-2", categoryId: "cat-2", quantity: 2, price: 15.5 },
			],
			totalAmountCents: 134950,
			source: OrderSource.PERDIEM,
			orderTime: new Date("2024-06-15T14:30:00Z"),
			orderTimeSeconds: 1718464200,
			currentTimeSeconds: 1718464200,
		};

		const buffer = encodeOrder(original);
		const decoded = decodeOrder(buffer);

		expect(decoded.orderId).to.equal(original.orderId);
		expect(decoded.items.length).to.equal(original.items.length);
		expect(decoded.items[0].itemId).to.equal(original.items[0].itemId);
		expect(decoded.items[0].categoryId).to.equal(original.items[0].categoryId);
		expect(decoded.items[0].quantity).to.equal(original.items[0].quantity);
		expect(decoded.items[0].price).to.equal(original.items[0].price);
		expect(decoded.items[1].itemId).to.equal(original.items[1].itemId);
		expect(decoded.items[1].categoryId).to.equal(original.items[1].categoryId);
		expect(decoded.items[1].quantity).to.equal(original.items[1].quantity);
		expect(decoded.items[1].price).to.equal(original.items[1].price);
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
		};

		const buffer = encodeBusyTime(original);
		const decoded = decodeBusyTime(buffer);

		expect(decoded.startTime.getTime()).to.equal(original.startTime.getTime());
		expect(decoded.endTime.getTime()).to.equal(original.endTime.getTime());
		expect(decoded.orderTimeSeconds).to.equal(original.orderTimeSeconds);
		expect(decoded.currentTimeSeconds).to.equal(original.currentTimeSeconds);
		expect(decoded.busyTimeSeconds).to.equal(original.busyTimeSeconds);
	});
});
