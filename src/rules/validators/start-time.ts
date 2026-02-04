import { isMatch } from "date-fns";

import type { RuleValidator } from "../types";

export const validateStartTime: RuleValidator = (rule) => {
	if (rule.startTime === undefined) {
		return;
	}

	if (typeof rule.startTime !== "string") {
		throw new Error("startTime must be a string in HH:mm or HH:mm:ss format");
	}

	if (!isMatch(rule.startTime, "HH:mm") && !isMatch(rule.startTime, "HH:mm:ss")) {
		throw new Error(
			`startTime must be in HH:mm or HH:mm:ss format (e.g., "09:30", "23:45:00"), got: "${rule.startTime}"`,
		);
	}
};
