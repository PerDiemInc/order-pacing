import type { RuleValidator } from "../types";

export const validateTimeFrame: RuleValidator = (rule) => {
	if (typeof rule.timeFrame !== "number" || rule.timeFrame <= 0) {
		throw new Error(
			"timeFrame must be a positive number greater than 0 (in minutes)",
		);
	}
};
