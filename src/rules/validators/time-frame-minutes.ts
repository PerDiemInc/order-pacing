import type { RuleValidator } from "../types";

export const validateTimeFrameMinutes: RuleValidator = (rule) => {
	if (typeof rule.timeFrameMinutes !== "number" || rule.timeFrameMinutes <= 0) {
		throw new Error("timeFrameMinutes must be a positive number greater than 0 (in minutes)");
	}
};
