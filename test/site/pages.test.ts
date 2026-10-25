import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hrefs, ids } from './helpers.js';

// The stores need the privacy and support pages to stay reachable, and every page links to the
// others from its nav and footer, so a renamed or missing page or anchor would break them all.

const SITE = 'site';
const pages = new Map(
  readdirSync(SITE)
    .filter((f) => f.endsWith('.html'))
    .map((file) => {
      const html = readFileSync(path.join(SITE, file), 'utf8');
      return [file, { html, ids: ids(html) }] as const;
    }),
);

describe('the site pages', () => {
  it('include the pages the app stores ask for', () => {
    expect([...pages.keys()]).toEqual(expect.arrayContaining(['index.html', 'privacy.html', 'support.html', 'help.html']));
  });

  for (const [page, { html }] of pages) {
    it(`${page}: every local link and asset points at a file that exists, and every anchor at an id`, () => {
      for (const href of hrefs(html)) {
        if (/^(https?:|mailto:)/.test(href)) continue;
        const [file, anchor] = href.split('#');
        const target = file === '' ? page : file === './' ? 'index.html' : file!;
        if (anchor === undefined) {
          expect(file === page || readdirSync(SITE).includes(target) || readdirSync(path.join(SITE, path.dirname(target))).includes(path.basename(target)), `${page} links to ${href}`).toBe(true);
        } else {
          expect(pages.get(target)?.ids, `${page} links to ${href}`).toContain(anchor);
        }
      }
    });

    it(`${page}: has a title, a description and the footer links to Help, Support and Privacy`, () => {
      expect(html).toMatch(/<title>[^<]+<\/title>/);
      expect(html).toMatch(/<meta name="description" content="[^"]+">/);
      for (const link of ['help.html', 'support.html', 'privacy.html']) expect(html).toContain(`href="${link}"`);
    });
  }

  it('the privacy policy states an effective date and covers the update check and stored files', () => {
    const html = pages.get('privacy.html')!.html;
    expect(html).toMatch(/Effective \d{1,2} [A-Z][a-z]+ \d{4}/);
    for (const text of ['api.github.com', 'presets.json', 'updates.json', 'renami.log']) expect(html).toContain(text);
  });
});
