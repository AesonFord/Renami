import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';
import type * as estree from 'estree';
import type { ProgramNode } from 'rollup';
import { parseAst } from 'rollup/parseAst';
import { describe, expect, it } from 'vitest';

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return listFiles(p);
    return /\.tsx?$/.test(p) ? [p] : [];
  });
}

/** Every module specifier a file imports or re-exports, including side-effect and dynamic imports. */
const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');

const PURE_CORE = [
  'core/types.js',
  'core/template/parse.js',
  'core/template/tokens.js',
  'core/names.js',
  'core/dateFormat.js',
  'core/preview.js',
];
const RENDERER_PACKAGES = [
  /^react$/,
  /^react-dom\/client$/,
  /^@tanstack\/react-virtual$/,
  /^@fontsource\/ibm-plex-(sans|mono)\/\d+\.css$/,
  // The preview panel's PDF pages, and its worker as a same-origin URL.
  /^pdfjs-dist$/,
  /^pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url$/,
];

/**
 * True when `node` is a literal value: a string/number/boolean/null literal, a template literal
 * with no interpolation, or an object/array literal built only from the same.
 */
function isLiteralValue(node: estree.Node | null | undefined): boolean {
  if (!node) return false;
  switch (node.type) {
    case 'Literal': {
      const { value } = node;
      // Excludes bigint and regex literals: same node type, but a different value shape.
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null;
    }
    case 'TemplateLiteral':
      return node.expressions.length === 0;
    case 'ObjectExpression':
      return node.properties.every((p) => p.type === 'Property' && !p.computed && !p.method && isLiteralValue(p.value));
    case 'ArrayExpression':
      return node.elements.every((el) => isLiteralValue(el));
    default:
      return false;
  }
}

/**
 * First identifier name found anywhere under `node`, walked in roughly source order (an ESTree
 * node's own properties are ordered the way the parser wrote them, e.g. `id` before `init`).
 * Undefined when the subtree has no identifier at all (an empty-specifier import, say).
 */
function firstIdentifierName(node: unknown): string | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = firstIdentifierName(child);
      if (found) return found;
    }
    return undefined;
  }
  const obj = node as Record<string, unknown>;
  if (obj.type === 'Identifier' && typeof obj.name === 'string') return obj.name;
  for (const key of Object.keys(obj)) {
    if (key === 'start' || key === 'end' || key === 'loc' || key === 'range' || key === 'type') continue;
    const found = firstIdentifierName(obj[key]);
    if (found) return found;
  }
  return undefined;
}

/** The 1-based line `needle` first appears on in `source`, or undefined when it isn't there. */
function lineOf(source: string, needle: string | undefined): number | undefined {
  if (needle === undefined) return undefined;
  const at = source.indexOf(needle);
  return at === -1 ? undefined : source.slice(0, at).split('\n').length;
}

/** The name a declaration statement introduces (its own name, not names nested inside it), if any. */
function declaredName(node: ProgramNode['body'][number]): string | undefined {
  switch (node.type) {
    case 'VariableDeclaration': {
      const id = node.declarations[0]?.id;
      return id?.type === 'Identifier' ? id.name : undefined;
    }
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      return node.id?.name;
    default:
      return undefined;
  }
}

/**
 * The local name esbuild's flattened `export { ... }` list re-exports as `default`, if the
 * program has one. `export default <expr>` becomes a same-shaped anonymous declaration (named
 * `stdin_default` when the expression had no name of its own, e.g. `export default 42`) plus
 * `export { stdin_default as default }`; `export default function foo() {}` keeps `foo`. Either
 * way, the declaration is a disguised `export default`, not a plain top-level `const`/function/
 * class — cross-referencing the export list (rather than special-casing esbuild's `stdin_default`
 * placeholder by name) catches both forms and doesn't depend on that placeholder's exact spelling.
 */
function defaultExportLocalName(program: ProgramNode): string | undefined {
  for (const node of program.body) {
    if (node.type !== 'ExportNamedDeclaration' || node.declaration !== null || node.source !== null) continue;
    for (const spec of node.specifiers) {
      // Both `exported` and `local` can be string Literals (`export { x as "y" }`), not just
      // Identifiers; `default` as a name is always the Identifier form.
      if (spec.exported.type === 'Identifier' && spec.exported.name === 'default' && spec.local.type === 'Identifier') {
        return spec.local.name;
      }
    }
  }
  return undefined;
}

/**
 * Why a top-level statement isn't "only types and constants", or null when it's fine.
 *
 * esbuild's `format: 'esm'` transform flattens every export into bare declarations plus one
 * trailing `export { ... }` list (verified by hand: `export const X = ...` becomes `const X = ...`
 * … `export { X };`), so that trailing list — declaration-less, source-less, non-empty — is itself
 * the one allowed export shape here, alongside the bare `const` declarations it collects.
 */
function violation(node: ProgramNode['body'][number], defaultLocalName: string | undefined): string | null {
  if (defaultLocalName !== undefined && declaredName(node) === defaultLocalName) return 'export default';
  switch (node.type) {
    case 'VariableDeclaration':
      if (node.kind !== 'const') return `${node.kind} declaration`;
      return node.declarations.every((d) => isLiteralValue(d.init)) ? null : 'const with a non-literal initializer';
    case 'ExportNamedDeclaration':
      return node.declaration === null && node.source === null && node.specifiers.length > 0 ? null : 'export declaration';
    case 'ImportDeclaration':
      // Every legitimate import here is `import type`, which esbuild erases entirely (verified by
      // hand). Anything still standing is a side-effect import or a value import that survived.
      return node.specifiers.length === 0 ? 'side-effect import' : 'value import (not erased as a type)';
    default:
      return node.type;
  }
}

/**
 * Where in the original source to point a violation at: the first candidate needle that's
 * actually found there. A declaration's own name usually appears verbatim (an anonymous default
 * export's synthesized `stdin_default` name never does, so falls through to the literal text
 * `export default`); an import's module specifier is the fallback for imports.
 */
function locate(node: ProgramNode['body'][number], source: string, reason: string): number | undefined {
  const candidates = [
    firstIdentifierName(node),
    node.type === 'ImportDeclaration' ? String(node.source.value) : undefined,
    reason === 'export default' ? 'export default' : undefined,
  ];
  for (const needle of candidates) {
    const line = lineOf(source, needle);
    if (line !== undefined) return line;
  }
  return undefined;
}

/**
 * Violations in one file's source, as "file:line: reason" strings; empty when the file holds only
 * types and constants. Strips types with esbuild, then walks the resulting plain JS with Rollup's
 * parser — interfaces, type aliases, `import type` and `as const` all disappear in the strip, so
 * whatever's left is exactly the runtime shape TypeScript would keep.
 */
function sharedBoundaryViolations(fileName: string, source: string): string[] {
  const stripped = transformSync(source, { loader: 'ts', format: 'esm' }).code;
  const program = parseAst(stripped);
  const defaultLocalName = defaultExportLocalName(program);
  return program.body.flatMap((node) => {
    const reason = violation(node, defaultLocalName);
    if (reason === null) return [];
    return [`${fileName}:${locate(node, source, reason) ?? '?'}: ${reason}`];
  });
}

describe('renderer boundary', () => {
  it('imports only React, its own files, shared types and pure core modules', () => {
    const bad: string[] = [];
    for (const file of listFiles('src/renderer')) {
      for (const spec of importsOf(file)) {
        const ok = spec.startsWith('.')
          ? !spec.includes('/core/') || PURE_CORE.some((m) => spec.endsWith(m))
          : RENDERER_PACKAGES.some((re) => re.test(spec));
        if (!ok) bad.push(`${file}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('shared boundary', () => {
  it('holds only types and constants', () => {
    for (const file of listFiles('src/shared')) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/^import (?!type )/m);
      for (const spec of importsOf(file)) {
        expect(spec.endsWith('core/types.js') || spec.endsWith('core/template/tokens.js'), `${file}: ${spec}`).toBe(true);
      }
    }
  });

  it('src/shared holds only types and constants', () => {
    const violations = listFiles('src/shared').flatMap((file) => sharedBoundaryViolations(file, readFileSync(file, 'utf8')));
    expect(violations).toEqual([]);
  });

  it('the checker reports code that is not a type or a constant, so it cannot pass vacuously', () => {
    expect(sharedBoundaryViolations('inline.ts', 'export function f() {}')).toEqual(['inline.ts:1: FunctionDeclaration']);
    expect(sharedBoundaryViolations('inline.ts', 'export const x = compute();')).toEqual([
      'inline.ts:1: const with a non-literal initializer',
    ]);
    expect(sharedBoundaryViolations('inline.ts', 'export default 42;')).toEqual(['inline.ts:1: export default']);
  });
});

describe('renderer CSP', () => {
  it('locks down object-src and base-uri while still allowing self scripts', () => {
    const html = readFileSync('src/renderer/index.html', 'utf8');
    const match = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html);
    expect(match, 'CSP meta tag').not.toBeNull();
    const csp = match?.[1] ?? '';
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("script-src 'self'");
  });
});

describe('main session boundary', () => {
  it('keeps Session and rows free of Electron so they run under plain Node', () => {
    const files = ['src/main/session.ts', 'src/main/rows.ts'].filter((f) => {
      try {
        return statSync(f).isFile();
      } catch {
        return false; // created in Task 3
      }
    });
    for (const file of files) expect(importsOf(file).filter((s) => s === 'electron'), file).toEqual([]);
  });
});
