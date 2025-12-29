export function toSeconds(date: Date | number): number {
	const milliseconds = typeof date === "number" ? date : date.getTime();

	return Math.floor(milliseconds / 1000);
}

export function scoreToDate(score: number): Date {
	return new Date(score * 1000);
}

export function minutesToSeconds(minutes: number): number {
	return minutes * 60;
}

export function secondsToMinutes(seconds: number): number {
	return Math.ceil(seconds / 60);
}
