/** Every href and src in a page, as written. */
export function hrefs(html: string): string[] {
  return [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1] ?? '');
}

/** Every id in a page, for checking anchors. */
export function ids(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? ''));
}
