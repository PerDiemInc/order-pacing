import { getDay, getHours, getMinutes } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import type { Rule } from "../rules/types";
import { timeStringToMinutes } from "../utils";
import type { Order, Threshold } from "./types";

export default class EngineRule {
	public readonly rule: Rule;

	constructor(rule: Rule) {
		this.rule = rule;
	}

	public doesApply(time: Date, timeZone: string): boolean {
		const zonedDate = toZonedTime(time, timeZone);
		const dayOfWeek = getDay(zonedDate);

		if (
			Array.isArray(this.rule.weekDays) &&
			this.rule.weekDays.length > 0 &&
			!this.rule.weekDays.includes(dayOfWeek)
		) {
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

	public exceedsThreshold(orders: Order[]): Threshold | null {
		const applicableCategoryIds: string[] = [];

		const relevantOrders =
			this.rule.categoryIds.length > 0
				? orders.filter((order) => {
						if (!order.items || order.items.length === 0) {
							return false;
						}

						return order.items.some((item) => {
							applicableCategoryIds.push(item.categoryId);

							return this.rule.categoryIds.includes(item.categoryId);
						});
					})
				: orders;

		const totalOrders = relevantOrders.length;

		const totalItems = relevantOrders.reduce(
			(ordersSum, order) =>
				ordersSum +
				(order.items?.reduce(
					(itemsSum, item) => itemsSum + (item.quantity ?? 1),
					0,
				) ?? 0),
			0,
		);

		const totalAmount = relevantOrders.reduce(
			(ordersSum, order) => ordersSum + (order.totalAmountCents ?? 0),
			0,
		);

		if (
			this.rule.maxOrders &&
			this.rule.maxOrders > 0 &&
			totalOrders >= this.rule.maxOrders
		) {
			return {
				type: "orders",
				value: totalOrders,
				limit: this.rule.maxOrders,
				categoryIds: applicableCategoryIds,
			};
		}

		if (
			this.rule.maxItems &&
			this.rule.maxItems > 0 &&
			totalItems >= this.rule.maxItems
		) {
			return {
				type: "items",
				value: totalItems,
				limit: this.rule.maxItems,
				categoryIds: applicableCategoryIds,
			};
		}

		if (
			this.rule.maxAmountCents &&
			this.rule.maxAmountCents > 0 &&
			totalAmount >= this.rule.maxAmountCents
		) {
			return {
				type: "amount",
				value: totalAmount,
				limit: this.rule.maxAmountCents,
				categoryIds: applicableCategoryIds,
			};
		}

		return null;
	}
}
