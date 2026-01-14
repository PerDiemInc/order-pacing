export enum TimeframeMode {
	CENTERED = "centered",
	BEFORE_ONLY = "before_only",
	AFTER_ONLY = "after_only",
	BEFORE_AND_AFTER = "before_and_after",
}

export enum OrderSource {
	PERDIEM = "perdiem",
	OTHER = "other",
}

export type TimeWindow = {
	start: number;
	end: number;
};

interface OrderItem {
	itemId: string;
	categoryId: string;
	quantity: number;
	totalAmountCents: number;
}

export interface Order {
	orderId: string;
	items: OrderItem[];
	totalAmountCents: number;
	source: OrderSource;
	orderTime: Date;
	orderTimeSeconds: number;
	currentTimeSeconds: number;
}

export interface InputOrder
	extends Omit<Order, "orderTimeSeconds" | "currentTimeSeconds"> {}

export interface Threshold {
	type: "orders" | "items" | "amount";
	value: number;
	limit: number;
	categoryIds: string[];
}

export interface BusyTimeContext {
	totalAmountCents: number;
	totalItems: number;
	totalOrders: number;
	categoryIds: string[];
}

export interface BusyTime {
	startTime: Date;
	endTime: Date;
	orderTimeSeconds: number;
	currentTimeSeconds: number;
	busyTimeSeconds: number;
	busyTimeContext: BusyTimeContext;
	threshold: Threshold;
}
