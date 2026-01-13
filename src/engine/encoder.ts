import { pack, unpack } from "msgpackr";
import type { BusyTime, Order } from "./types";

export function encodeOrder(order: Order): Buffer {
	return pack({
		orderId: order.orderId,
		items: order.items,
		totalAmountCents: order.totalAmountCents,
		source: order.source,
		orderTime: order.orderTime,
		// @todo: derived
		orderTimeSeconds: order.orderTimeSeconds,
		currentTimeSeconds: order.currentTimeSeconds,
	});
}

export function decodeOrder(buffer: Buffer): Order {
	const data = unpack(buffer) as Order;

	return {
		orderId: data.orderId,
		items: data.items,
		totalAmountCents: data.totalAmountCents,
		source: data.source,
		orderTime: data.orderTime,
		// @todo: derived
		orderTimeSeconds: data.orderTimeSeconds,
		currentTimeSeconds: data.currentTimeSeconds,
	};
}

export function encodeBusyTime(busyTime: BusyTime): Buffer {
	return pack({
		// @todo: derived
		startTime: busyTime.startTime,
		// @todo: derived
		endTime: busyTime.endTime,
		orderTimeSeconds: busyTime.orderTimeSeconds,
		currentTimeSeconds: busyTime.currentTimeSeconds,
		busyTimeSeconds: busyTime.busyTimeSeconds,
	});
}

export function decodeBusyTime(buffer: Buffer): BusyTime {
	const busyTime = unpack(buffer) as BusyTime;

	return {
		// @todo: derived
		startTime: busyTime.startTime,
		// @todo: derived
		endTime: busyTime.endTime,
		orderTimeSeconds: busyTime.orderTimeSeconds,
		currentTimeSeconds: busyTime.currentTimeSeconds,
		busyTimeSeconds: busyTime.busyTimeSeconds,
	};
}
