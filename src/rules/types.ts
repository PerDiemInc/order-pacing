export interface Rule {
	timeFrameMinutes: number;
	busyTimeMinutes: number;
	categoryIds: string[];
	weekDays: number[];
	startTime?: string;
	endTime?: string;
	maxOrders?: number;
	maxItems?: number;
	maxAmountCents?: number;
}

export type RuleValidator = (rule: Rule) => void;
