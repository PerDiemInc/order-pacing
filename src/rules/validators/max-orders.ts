import type { RuleValidator } from "../types";

export const validateMaxOrders: RuleValidator = (rule) => {
	if (rule.maxOrders === undefined) {
		return;
	}

	if (typeof rule.maxOrders !== "number" || rule.maxOrders <= 0) {
		throw new Error("maxOrders must be a positive number greater than 0");
	}
};
