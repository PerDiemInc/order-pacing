import type { RuleValidator } from "../types";

export const validateWeekDays: RuleValidator = (rule) => {
	if (!Array.isArray(rule.weekDays)) {
		throw new Error("weekDays must be an array");
	}

	if (rule.weekDays.length > 0) {
		for (const day of rule.weekDays) {
			if (typeof day !== "number" || day < 0 || day > 6) {
				throw new Error(
					"weekDays must contain numbers between 0 (Sunday) and 6 (Saturday)",
				);
			}
		}
	}
};
