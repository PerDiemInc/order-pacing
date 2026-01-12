import type { RuleValidator } from "../types";

export const validateRuleNotNull: RuleValidator = (rule) => {
	if (!rule) {
		throw new Error("Rule cannot be null or undefined");
	}
};
