import type { RuleValidator } from "../types";

export const validateCategoryIds: RuleValidator = (rule) => {
	if (rule.categoryIds === undefined) {
		return;
	}

	if (!Array.isArray(rule.categoryIds)) {
		throw new Error("categoryIds must be an array");
	}
};
