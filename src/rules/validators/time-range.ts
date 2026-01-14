import { timeStringToMinutes } from "../../utils";
import type { RuleValidator } from "../types";

export const validateTimeRange: RuleValidator = (rule) => {
	if (rule.startTime !== undefined && rule.endTime !== undefined) {
		const startMinutes = timeStringToMinutes(rule.startTime);
		const endMinutes = timeStringToMinutes(rule.endTime);

		if (startMinutes >= endMinutes) {
			throw new Error("startTime must be less than endTime");
		}
	}
};
