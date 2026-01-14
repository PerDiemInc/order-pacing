import { Packr } from "msgpackr";
import type { BusyTime, Order } from "./engine/types";
import { OrderSource } from "./engine/types";

const packr = new Packr({
	useRecords: true,
	useTimestamp32: true,
});

enum OrderSourceMap {
	PERDIEM = "P",
	OTHER = "O",
}

enum OrderItemKeyMap {
	itemId = "i",
	categoryId = "c",
	quantity = "q",
	totalAmountCents = "tac",
}

enum OrderKeyMap {
	orderId = "id",
	items = "is",
	totalAmountCents = "t",
	source = "s",
	orderTime = "ot",
	orderTimeSeconds = "ots",
	currentTimeSeconds = "cts",
}

enum ThresholdKeyMap {
	type = "t",
	value = "v",
	limit = "l",
	categoryIds = "c",
}

enum BusyTimeContextKeyMap {
	totalAmountCents = "tac",
	totalItems = "ti",
	totalOrders = "to",
	categoryIds = "c",
}

enum BusyTimeKeyMap {
	startTime = "st",
	endTime = "et",
	orderTimeSeconds = "ots",
	currentTimeSeconds = "cts",
	busyTimeSeconds = "bts",
	busyTimeContext = "btc",
	threshold = "t",
}

export function encodeOrder(order: Order): Buffer {
	const encodedItems = (order.items || []).map((item) => ({
		[OrderItemKeyMap.itemId]: item.itemId ?? "",
		[OrderItemKeyMap.categoryId]: item.categoryId ?? "",
		[OrderItemKeyMap.quantity]: item.quantity ?? 0,
		[OrderItemKeyMap.totalAmountCents]: item.totalAmountCents ?? 0,
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
			totalAmountCents: item[OrderItemKeyMap.totalAmountCents],
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
		[BusyTimeKeyMap.busyTimeContext]: {
			[BusyTimeContextKeyMap.totalAmountCents]:
				busyTime.busyTimeContext.totalAmountCents ?? 0,
			[BusyTimeContextKeyMap.totalItems]:
				busyTime.busyTimeContext.totalItems ?? 0,
			[BusyTimeContextKeyMap.totalOrders]:
				busyTime.busyTimeContext.totalOrders ?? 0,
			[BusyTimeContextKeyMap.categoryIds]:
				busyTime.busyTimeContext.categoryIds ?? [],
		},
		[BusyTimeKeyMap.threshold]: {
			[ThresholdKeyMap.type]: busyTime.threshold.type,
			[ThresholdKeyMap.value]: busyTime.threshold.value ?? 0,
			[ThresholdKeyMap.limit]: busyTime.threshold.limit ?? 0,
			[ThresholdKeyMap.categoryIds]: busyTime.threshold.categoryIds ?? [],
		},
	});
}

export function decodeBusyTime(buffer: Buffer): BusyTime {
	const data = packr.unpack(buffer) as Record<string, unknown>;

	const busyTimeContext = data[BusyTimeKeyMap.busyTimeContext] as Record<
		string,
		unknown
	>;
	const threshold = data[BusyTimeKeyMap.threshold] as Record<string, unknown>;

	return {
		startTime: data[BusyTimeKeyMap.startTime],
		endTime: data[BusyTimeKeyMap.endTime],
		orderTimeSeconds: data[BusyTimeKeyMap.orderTimeSeconds],
		currentTimeSeconds: data[BusyTimeKeyMap.currentTimeSeconds],
		busyTimeSeconds: data[BusyTimeKeyMap.busyTimeSeconds],
		busyTimeContext: {
			totalAmountCents: busyTimeContext[BusyTimeContextKeyMap.totalAmountCents],
			totalItems: busyTimeContext[BusyTimeContextKeyMap.totalItems],
			totalOrders: busyTimeContext[BusyTimeContextKeyMap.totalOrders],
			categoryIds: busyTimeContext[BusyTimeContextKeyMap.categoryIds],
		},
		threshold: {
			type: threshold[ThresholdKeyMap.type],
			value: threshold[ThresholdKeyMap.value],
			limit: threshold[ThresholdKeyMap.limit],
			categoryIds: threshold[ThresholdKeyMap.categoryIds],
		},
	} as BusyTime;
}
