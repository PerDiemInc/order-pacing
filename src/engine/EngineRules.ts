import { defaultRuleSet } from "../rules";
import type { Rule } from "../rules/types";
import EngineRule from "./EngineRule";

export default class EngineRules {
	private rules: Rule[] = [];

	constructor(rules: Rule[]) {
		if (!Array.isArray(rules)) {
			throw new TypeError("rules must be an array of Rule objects");
		}

		for (const rule of rules) {
			try {
				defaultRuleSet.validate(rule);
			} catch (error) {
				throw new Error(`Invalid rule "${rule?.ruleId}": ${(error as Error).message}`);
			}
		}

		this.rules = [...rules];
	}

	public hasRules(): boolean {
		return this.rules.length > 0;
	}

	public getEngineRules(): EngineRule[] {
		return this.rules.map((rule) => new EngineRule(rule));
	}
}
