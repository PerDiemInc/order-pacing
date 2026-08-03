import type { RuleValidator } from "../types";

export const validateBusyTimeMinutes: RuleValidator = (rule) => {
	if (typeof rule.busyTimeMinutes !== "number" || rule.busyTimeMinutes < 5) {
		throw new Error("busyTimeMinutes must be a number >= 5 (in minutes)");
	}
};
