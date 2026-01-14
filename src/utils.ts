export function toSeconds(date: Date | number): number {
	const milliseconds = typeof date === "number" ? date : date.getTime();

	return Math.floor(milliseconds / 1000);
}

export function secondsToDate(seconds: number): Date {
	return new Date(seconds * 1000);
}

export function minutesToSeconds(minutes: number): number {
	return minutes * 60;
}

export function secondsToMinutes(seconds: number): number {
	return Math.ceil(seconds / 60);
}

export function timeStringToMinutes(timeString: string): number {
	const [hours, minutes] = timeString.split(":").map(Number);

	return hours * 60 + minutes;
}
