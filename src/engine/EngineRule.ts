import { getDay, getHours, getMinutes } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import type { Rule } from "../rules/types";
import { matchesTags, timeStringToMinutes } from "../utils";
import type { BusyTimeContext, Order, Threshold } from "./types";

export default class EngineRule {
	public readonly rule: Rule;

	constructor(rule: Rule) {
		this.rule = rule;
	}

	public get scope(): string[] {
		return this.rule.tags ?? [];
	}

	public applyCheck(order: Order, timeZone: string): boolean {
		if (!matchesTags(this.scope, order.tags)) {
			return false;
		}

		const zonedDate = toZonedTime(order.orderTime, timeZone);
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
		const ruleCategoryIds = this.rule.categoryIds ?? [];

		const allCategoryIds = new Set<string>();
		let allOrdersTotalItems = 0;
		let allOrdersTotalAmountCents = 0;

		for (const order of orders) {
			allOrdersTotalAmountCents += order.totalAmountCents ?? 0;

			for (const item of order.items ?? []) {
				allOrdersTotalItems += item.quantity ?? 1;

				if (item.categoryId) {
					allCategoryIds.add(item.categoryId);
				}
			}
		}

		const matchedOrders = orders.filter((order) => matchesTags(this.scope, order.tags));

		let totalOrders = matchedOrders.length;
		let totalItems = 0;
		let totalAmount = 0;

		if (ruleCategoryIds.length > 0) {
			totalOrders = 0;

			for (const order of matchedOrders) {
				let hasMatchingCategory = false;

				for (const item of order.items ?? []) {
					if (item.categoryId && ruleCategoryIds.includes(item.categoryId)) {
						hasMatchingCategory = true;
						totalItems += item.quantity ?? 1;
						totalAmount += item.totalAmountCents ?? 0;
					}
				}

				if (hasMatchingCategory) {
					totalOrders += 1;
				}
			}
		} else {
			for (const order of matchedOrders) {
				totalAmount += order.totalAmountCents ?? 0;

				for (const item of order.items ?? []) {
					totalItems += item.quantity ?? 1;
				}
			}
		}

		const busyTimeContext: BusyTimeContext = {
			totalAmountCents: allOrdersTotalAmountCents,
			totalItems: allOrdersTotalItems,
			totalOrders: orders.length,
			categoryIds: Array.from(allCategoryIds),
		};

		const reached = (type: Threshold["type"], value: number, limit: number) => ({
			threshold: { type, value, limit, categoryIds: ruleCategoryIds },
			busyTimeContext,
		});

		if (this.rule.maxOrders && this.rule.maxOrders > 0 && totalOrders >= this.rule.maxOrders) {
			return reached("orders", totalOrders, this.rule.maxOrders);
		}

		if (this.rule.maxItems && this.rule.maxItems > 0 && totalItems >= this.rule.maxItems) {
			return reached("items", totalItems, this.rule.maxItems);
		}

		if (this.rule.maxAmountCents && this.rule.maxAmountCents > 0 && totalAmount >= this.rule.maxAmountCents) {
			return reached("amount", totalAmount, this.rule.maxAmountCents);
		}

		return null;
	}
}
