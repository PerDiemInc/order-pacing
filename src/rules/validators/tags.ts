import type { RuleValidator } from "../types";

export const validateTags: RuleValidator = (rule) => {
	if (rule.tags === undefined) {
		return;
	}

	if (!Array.isArray(rule.tags)) {
		throw new Error("tags must be an array");
	}

	for (const tag of rule.tags) {
		if (typeof tag !== "string" || tag.trim().length === 0) {
			throw new Error("tags must contain non-empty strings");
		}
	}
};
