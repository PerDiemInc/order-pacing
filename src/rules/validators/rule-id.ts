import type { RuleValidator } from "../types";

export const validateRuleId: RuleValidator = (rule) => {
	if (typeof rule.ruleId !== "string" || rule.ruleId.trim().length === 0) {
		throw new Error("ruleId must be a non-empty string");
	}
};
