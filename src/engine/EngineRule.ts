import { getDay, getHours, getMinutes } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import type { Rule } from "../rules/types";
import { timeStringToMinutes } from "../utils";
import type { Order } from "./types";

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

	public exceedsThreshold(orders: Order[]): boolean {
		const relevantOrders =
			this.rule.categoryIds.length > 0
				? orders.filter((order) => {
						if (!order.items || order.items.length === 0) {
							return false;
						}

						return order.items.some((item) =>
							this.rule.categoryIds.includes(item.categoryId),
						);
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

		const totalPriceSum = relevantOrders.reduce(
			(ordersSum, order) => ordersSum + (order.totalAmountCents ?? 0),
			0,
		);

		return (
			(this.rule.maxOrders != null && totalOrders >= this.rule.maxOrders) ||
			(this.rule.maxItems != null && totalItems >= this.rule.maxItems) ||
			(this.rule.maxAmountCents != null &&
				totalPriceSum >= this.rule.maxAmountCents)
		);
	}
}
