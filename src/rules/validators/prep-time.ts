import type { RuleValidator } from "../types";

export const validatePrepTime: RuleValidator = (rule) => {
	if (typeof rule.prepTime !== "number" || rule.prepTime <= 0) {
		throw new Error(
			"prepTime must be a positive number greater than 0 (in minutes)",
		);
	}
};
