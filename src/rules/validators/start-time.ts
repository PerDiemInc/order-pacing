import { isMatch } from "date-fns";

import type { RuleValidator } from "../types";

export const validateStartTime: RuleValidator = (rule) => {
	if (rule.startTime === undefined) {
		return;
	}

	if (typeof rule.startTime !== "string") {
		throw new Error("startTime must be a string in HH:mm format");
	}

	if (!isMatch(rule.startTime, "HH:mm")) {
		throw new Error(`startTime must be in HH:mm format (e.g., "09:30", "23:45"), got: "${rule.startTime}"`);
	}
};
