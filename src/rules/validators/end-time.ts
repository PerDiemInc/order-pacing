import { isMatch } from "date-fns";

import type { RuleValidator } from "../types";

export const validateEndTime: RuleValidator = (rule) => {
	if (rule.endTime === undefined) {
		return;
	}

	if (typeof rule.endTime !== "string") {
		throw new Error("endTime must be a string in HH:mm format");
	}

	if (!isMatch(rule.endTime, "HH:mm")) {
		throw new Error(
			`endTime must be in HH:mm format (e.g., "09:30", "23:45"), got: "${rule.endTime}"`,
		);
	}
};
