import type { Rule, RuleValidator } from "./types";

export class RuleSet {
	validators: RuleValidator[] = [];

	constructor(...validators: RuleValidator[]) {
		this.validators = validators;
	}

	validate(rule: Rule): void {
		for (const validator of this.validators) {
			validator(rule);
		}
	}
}
