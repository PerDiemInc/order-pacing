import type { RuleValidator } from "../types";

export const validateMaxAmountCents: RuleValidator = (rule) => {
	if (rule.maxAmountCents === undefined) {
		return;
	}

	if (typeof rule.maxAmountCents !== "number" || rule.maxAmountCents <= 0) {
		throw new Error("maxAmountCents must be a positive number greater than 0");
	}
};
