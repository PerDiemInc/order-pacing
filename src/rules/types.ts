/** A tag the order must carry, or a list of tags it must carry at least one of. */
export type RuleTag = string | string[];

export interface Rule {
	ruleId: string;
	timeFrameMinutes: number;
	busyTimeMinutes: number;
	categoryIds?: string[];
	tags?: RuleTag[];
	weekDays?: number[];
	startTime?: string;
	endTime?: string;
	maxOrders?: number;
	maxItems?: number;
	maxAmountCents?: number;
}

export type RuleValidator = (rule: Rule) => void;
