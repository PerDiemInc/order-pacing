import type { RuleValidator } from "../types";

export const validateBusyTimeMinutes: RuleValidator = (rule) => {
	if (typeof rule.busyTimeMinutes !== "number" || rule.busyTimeMinutes <= 0) {
		throw new Error(
			"busyTimeMinutes must be a positive number greater than 0 (in minutes)",
		);
	}
};
