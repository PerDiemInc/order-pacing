import { getDay, getHours, getMinutes } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import type { Rule } from "../rules/types";
import { timeStringToMinutes } from "../utils";
import type { BusyTimeContext, Order, Threshold } from "./types";

export default class EngineRule {
	public readonly rule: Rule;

	constructor(rule: Rule) {
		this.rule = rule;
	}

	public applyCheck(time: Date, timeZone: string): boolean {
		const zonedDate = toZonedTime(time, timeZone);
		const dayOfWeek = getDay(zonedDate);

		if (Array.isArray(this.rule.weekDays) && this.rule.weekDays.length > 0 && !this.rule.weekDays.includes(dayOfWeek)) {
			return false;
		}

		const orderMinutes = getHours(zonedDate) * 60 + getMinutes(zonedDate);

		if (this.rule.startTime) {
			const startTimeMinutes = timeStringToMinutes(this.rule.startTime);

			if (orderMinutes < startTimeMinutes) {
				return false;
			}
		}

		if (this.rule.endTime) {
			const endTimeMinutes = timeStringToMinutes(this.rule.endTime);

			if (orderMinutes > endTimeMinutes) {
				return false;
			}
		}

		return true;
	}

	public thresholdCheck(orders: Order[]): { threshold: Threshold; busyTimeContext: BusyTimeContext } | null {
		const allOrdersTotalItems = orders.reduce(
			(ordersSum, order) =>
				ordersSum + (order.items?.reduce((itemsSum, item) => itemsSum + (item.quantity ?? 1), 0) ?? 0),
			0,
		);

		const allOrdersTotalAmountCents = orders.reduce((ordersSum, order) => ordersSum + (order.totalAmountCents ?? 0), 0);

		const allOrdersCategoryIds = new Set<string>();

		for (const order of orders) {
			if (order.items) {
				for (const item of order.items) {
					if (item.categoryId) {
						allOrdersCategoryIds.add(item.categoryId);
					}
				}
			}
		}

		let applicableTotalAmountCents = 0;
		let applicableTotalItems = 0;

		const relevantOrders =
			this.rule.categoryIds.length > 0
				? orders.filter((order) => {
						if (!order.items || order.items.length === 0) {
							return false;
						}

						let hasMatchingCategory = false;

						for (const item of order.items) {
							if (item.categoryId && this.rule.categoryIds.includes(item.categoryId)) {
								hasMatchingCategory = true;
								applicableTotalAmountCents += item.totalAmountCents ?? 0;
								applicableTotalItems += item.quantity ?? 1;
							}
						}

						return hasMatchingCategory;
					})
				: orders;

		const totalOrders = relevantOrders.length;

		const totalItems = this.rule.categoryIds.length > 0 ? applicableTotalItems : allOrdersTotalItems;

		const totalAmount = this.rule.categoryIds.length > 0 ? applicableTotalAmountCents : allOrdersTotalAmountCents;

		if (this.rule.maxOrders && this.rule.maxOrders > 0 && totalOrders >= this.rule.maxOrders) {
			return {
				threshold: {
					type: "orders",
					value: totalOrders,
					limit: this.rule.maxOrders,
					categoryIds: this.rule.categoryIds,
				},
				busyTimeContext: {
					totalAmountCents: allOrdersTotalAmountCents,
					totalItems: allOrdersTotalItems,
					totalOrders: orders.length,
					categoryIds: Array.from(allOrdersCategoryIds),
				},
			};
		}

		if (this.rule.maxItems && this.rule.maxItems > 0 && totalItems >= this.rule.maxItems) {
			return {
				threshold: {
					type: "items",
					value: totalItems,
					limit: this.rule.maxItems,
					categoryIds: this.rule.categoryIds,
				},
				busyTimeContext: {
					totalAmountCents: allOrdersTotalAmountCents,
					totalItems: allOrdersTotalItems,
					totalOrders: orders.length,
					categoryIds: Array.from(allOrdersCategoryIds),
				},
			};
		}

		if (this.rule.maxAmountCents && this.rule.maxAmountCents > 0 && totalAmount >= this.rule.maxAmountCents) {
			return {
				threshold: {
					type: "amount",
					value: totalAmount,
					limit: this.rule.maxAmountCents,
					categoryIds: this.rule.categoryIds,
				},
				busyTimeContext: {
					totalAmountCents: allOrdersTotalAmountCents,
					totalItems: allOrdersTotalItems,
					totalOrders: orders.length,
					categoryIds: Array.from(allOrdersCategoryIds),
				},
			};
		}

		return null;
	}
}
