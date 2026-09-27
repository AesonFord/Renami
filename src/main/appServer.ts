import path from 'node:path';

/** The scheme the built renderer is served from; file:// pages are a null origin, this is not. */
export const APP_SCHEME = 'renami-app';
export const APP_ORIGIN = 'renami-app://app';

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  map: 'application/json',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
};

export function assetMime(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

/** The file under `root` this URL asks for, or null for anything that would escape root. */
export function resolveAppPath(url: string, root: string): string | null {
  let pathname: string;
  try {
    const u = new URL(url);
    if (u.protocol !== `${APP_SCHEME}:` || u.host !== 'app') return null;
    pathname = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = path.normalize(path.join(root, rel));
  return full.startsWith(path.normalize(root + path.sep)) ? full : null;
}
