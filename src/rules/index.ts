import { RuleSet } from "./RuleSet";
import { validateAtLeastOneThreshold } from "./validators/at-least-one-threshold";
import { validateBusyTimeMinutes } from "./validators/busy-time-minutes";
import { validateCategoryIds } from "./validators/category-ids";
import { validateEndTime } from "./validators/end-time";
import { validateMaxAmountCents } from "./validators/max-amount-cents";
import { validateMaxItems } from "./validators/max-items";
import { validateMaxOrders } from "./validators/max-orders";
import { validateRuleNotNull } from "./validators/rule-not-null";
import { validateStartTime } from "./validators/start-time";
import { validateTimeFrameMinutes } from "./validators/time-frame-minutes";
import { validateTimeRange } from "./validators/time-range";
import { validateWeekDays } from "./validators/week-days";

export const defaultRuleSet = new RuleSet(
	validateRuleNotNull,
	validateTimeFrameMinutes,
	validateBusyTimeMinutes,
	validateCategoryIds,
	validateWeekDays,
	validateStartTime,
	validateEndTime,
	validateTimeRange,
	validateMaxOrders,
	validateMaxItems,
	validateMaxAmountCents,
	validateAtLeastOneThreshold,
);
