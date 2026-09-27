import type { ExtensionRule } from './types.js';

/** Trims, drops leading dots and lowercases a typed extension. */
export function normalizeExtension(text: string): string {
  return text.trim().replace(/^\.+/, '').toLowerCase();
}

/**
 * The extension a file ends up with. The first rule whose `from` matches wins and its `to`
 * (normalized; '' removes the extension) is used as is. Otherwise `lowercase` decides.
 */
export function applyExtensionRules(
  ext: string,
  rules: readonly ExtensionRule[],
  lowercase: boolean,
): string {
  const key = ext.toLowerCase();
  const rule = rules.find((r) => {
    const from = normalizeExtension(r.from);
    return from !== '' && from === key;
  });
  if (rule) return normalizeExtension(rule.to);
  return lowercase ? key : ext;
}
