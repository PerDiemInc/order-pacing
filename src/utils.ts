export function toSeconds(date: Date | number): number {
	const milliseconds = typeof date === "number" ? date : date.getTime();

	return Math.floor(milliseconds / 1000);
}

export function secondsToDate(seconds: number): Date {
	return new Date(seconds * 1000);
}

export function timeStringToMinutes(timeString: string): number {
	const [hours, minutes] = timeString.split(":").map(Number);

	return hours * 60 + minutes;
}

export function matchesTags(ruleTags: string[], tags: string[]): boolean {
	return ruleTags.every((ruleTag) => tags.includes(ruleTag));
}

export function matchesCategories(ruleCategoryIds: string[] = [], categoryIds?: string[]): boolean {
	if (!categoryIds || ruleCategoryIds.length === 0) {
		return true;
	}

	return ruleCategoryIds.some((ruleCategoryId) => categoryIds.includes(ruleCategoryId));
}
