import { defaultRuleSet } from "../rules";
import type { Rule } from "../rules/types";
import EngineRule from "./EngineRule";

export default class EngineRules {
	private rules: Rule[] = [];

	constructor(rules: Rule[]) {
		if (!Array.isArray(rules)) {
			return;
		}

		for (const rule of rules) {
			defaultRuleSet.validate(rule);
		}

		this.rules = rules;
	}

	public hasRules(): boolean {
		return this.rules.length > 0;
	}

	public getEngineRules(): EngineRule[] {
		return this.rules.map((rule) => new EngineRule(rule));
	}
}
