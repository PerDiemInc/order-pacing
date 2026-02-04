import { isMatch } from "date-fns";

import type { RuleValidator } from "../types";

export const validateEndTime: RuleValidator = (rule) => {
	if (rule.endTime === undefined) {
		return;
	}

	if (typeof rule.endTime !== "string") {
		throw new Error("endTime must be a string in HH:mm or HH:mm:ss format");
	}

	if (!isMatch(rule.endTime, "HH:mm") && !isMatch(rule.endTime, "HH:mm:ss")) {
		throw new Error(`endTime must be in HH:mm or HH:mm:ss format (e.g., "09:30", "23:45:00"), got: "${rule.endTime}"`);
	}
};
