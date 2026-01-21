import type { RuleValidator } from "../types";

export const validateAtLeastOneThreshold: RuleValidator = (rule) => {
	if (rule.maxOrders === undefined && rule.maxItems === undefined && rule.maxAmountCents === undefined) {
		throw new Error("At least one threshold must be set (maxOrders, maxItems, or maxAmountCents)");
	}
};
