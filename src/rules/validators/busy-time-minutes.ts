import type { RuleValidator } from "../types";

export const validateBusyTimeMinutes: RuleValidator = (rule) => {
	if (typeof rule.busyTimeMinutes !== "number" || rule.busyTimeMinutes < 15) {
		throw new Error("busyTimeMinutes must be a number >= 15 (in minutes)");
	}
};
