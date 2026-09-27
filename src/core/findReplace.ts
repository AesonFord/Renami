import type { FindReplaceRule, RuleScope } from './types.js';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Returns an error message for the first invalid regex rule, or null. */
export function validateRules(rules: readonly FindReplaceRule[]): string | null {
  for (const [i, rule] of rules.entries()) {
    if (!rule.regex || rule.find === '') continue;
    try {
      new RegExp(rule.find);
    } catch (e) {
      return `Find & replace rule ${i + 1}: ${(e as Error).message}`;
    }
  }
  return null;
}

/** Applies rules in order to the current name without extension. Call validateRules first. */
export function applyFindReplace(stem: string, rules: readonly FindReplaceRule[]): string {
  let out = stem;
  for (const rule of rules) {
    if (rule.find === '') continue;
    const flags = rule.matchCase ? 'g' : 'gi';
    if (rule.regex) {
      out = out.replace(new RegExp(rule.find, flags), rule.replace);
    } else {
      out = out.replace(new RegExp(escapeRegExp(rule.find), flags), () => rule.replace);
    }
  }
  return out;
}

/** The rules that run at one stage. A rule without a scope is an original-name rule. */
export function rulesFor(rules: readonly FindReplaceRule[], scope: RuleScope): FindReplaceRule[] {
  return rules.filter((r) => (r.scope ?? 'original') === scope);
}
