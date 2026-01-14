export interface Rule {
	timeFrame: number;
	prepTime: number;
	categoryIds: string[];
	weekDays: number[];
	startTime?: string;
	endTime?: string;
	maxOrders?: number;
	maxItems?: number;
	maxAmountCents?: number;
}

export type RuleValidator = (rule: Rule) => void;
