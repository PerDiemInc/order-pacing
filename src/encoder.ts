import { Packr } from "msgpackr";
import type { BusyTime, Order } from "./engine/types";
import { OrderSource } from "./engine/types";

const packr = new Packr({
	useRecords: true,
	useTimestamp32: true,
});

enum OrderSourceMap {
	PERDIEM,
	OTHER,
}

enum OrderItemKeyMap {
	itemId,
	categoryId,
	quantity,
	price,
}

enum OrderKeyMap {
	orderId,
	items,
	totalAmountCents,
	source,
	orderTime,
	orderTimeSeconds,
	currentTimeSeconds,
}

enum BusyTimeKeyMap {
	startTime,
	endTime,
	orderTimeSeconds,
	currentTimeSeconds,
	busyTimeSeconds,
}

export function encodeOrder(order: Order): Buffer {
	const encodedItems = (order.items || []).map((item) => ({
		[OrderItemKeyMap.itemId]: item.itemId ?? "",
		[OrderItemKeyMap.categoryId]: item.categoryId ?? "",
		[OrderItemKeyMap.quantity]: item.quantity ?? 0,
		[OrderItemKeyMap.price]: item.price ?? 0,
	}));

	return packr.pack({
		[OrderKeyMap.orderId]: order.orderId ?? "",
		[OrderKeyMap.items]: encodedItems,
		[OrderKeyMap.totalAmountCents]: order.totalAmountCents ?? 0,
		[OrderKeyMap.source]:
			order.source === OrderSource.PERDIEM
				? OrderSourceMap.PERDIEM
				: OrderSourceMap.OTHER,
		[OrderKeyMap.orderTime]: order.orderTime,
		[OrderKeyMap.orderTimeSeconds]: order.orderTimeSeconds ?? 0,
		[OrderKeyMap.currentTimeSeconds]: order.currentTimeSeconds ?? 0,
	});
}

export function decodeOrder(buffer: Buffer): Order {
	const data = packr.unpack(buffer) as Record<string, unknown>;

	const decodedItems = Array.prototype.map.call(
		data[OrderKeyMap.items] || [],
		(item: Record<string, unknown>) => ({
			itemId: item[OrderItemKeyMap.itemId],
			categoryId: item[OrderItemKeyMap.categoryId],
			quantity: item[OrderItemKeyMap.quantity],
			price: item[OrderItemKeyMap.price],
		}),
	);

	return {
		orderId: data[OrderKeyMap.orderId],
		items: decodedItems,
		totalAmountCents: data[OrderKeyMap.totalAmountCents],
		source:
			data[OrderKeyMap.source] === OrderSourceMap.PERDIEM
				? OrderSource.PERDIEM
				: OrderSource.OTHER,
		orderTime: data[OrderKeyMap.orderTime],
		orderTimeSeconds: data[OrderKeyMap.orderTimeSeconds],
		currentTimeSeconds: data[OrderKeyMap.currentTimeSeconds],
	} as Order;
}

export function encodeBusyTime(busyTime: BusyTime): Buffer {
	return packr.pack({
		[BusyTimeKeyMap.startTime]: busyTime.startTime,
		[BusyTimeKeyMap.endTime]: busyTime.endTime,
		[BusyTimeKeyMap.orderTimeSeconds]: busyTime.orderTimeSeconds,
		[BusyTimeKeyMap.currentTimeSeconds]: busyTime.currentTimeSeconds,
		[BusyTimeKeyMap.busyTimeSeconds]: busyTime.busyTimeSeconds,
	});
}

export function decodeBusyTime(buffer: Buffer): BusyTime {
	const data = packr.unpack(buffer) as Record<string, unknown>;

	return {
		startTime: data[BusyTimeKeyMap.startTime],
		endTime: data[BusyTimeKeyMap.endTime],
		orderTimeSeconds: data[BusyTimeKeyMap.orderTimeSeconds],
		currentTimeSeconds: data[BusyTimeKeyMap.currentTimeSeconds],
		busyTimeSeconds: data[BusyTimeKeyMap.busyTimeSeconds],
	} as BusyTime;
}
