import type { RuleValidator } from "../types";

export const validateMaxItems: RuleValidator = (rule) => {
	if (rule.maxItems === undefined) {
		return;
	}

	if (typeof rule.maxItems !== "number" || rule.maxItems <= 0) {
		throw new Error("maxItems must be a positive number greater than 0");
	}
};
