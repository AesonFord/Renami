import { describe, expect, it } from 'vitest';
import {
  applyCase,
  asciiOnly,
  cleanSegment,
  isReservedWindowsName,
  stripDiacritics,
  utf8Bytes,
  type CleanupOptions,
} from '../../src/core/cleanup.js';
import type { Part } from '../../src/core/template/render.js';

const lit = (text: string): Part => ({ text, token: false });
const tok = (text: string): Part => ({ text, token: true });
const plain: CleanupOptions = { caseMode: 'none', spacesToUnderscores: false };
const clean = (s: string, opts: Partial<CleanupOptions> = {}) => cleanSegment([lit(s)], { ...plain, ...opts } as CleanupOptions);

describe('cleanSegment: empty tokens', () => {
  it('drops the separator next to an empty token at the start or end', () => {
    expect(cleanSegment([tok(''), lit('_'), tok('Title')], plain)).toBe('Title');
    expect(cleanSegment([tok('Title'), lit(' - '), tok('')], plain)).toBe('Title');
  });
  it('keeps separators the user typed at the edges', () => {
    expect(cleanSegment([lit('_draft_'), tok('x')], plain)).toBe('_draft_x');
  });
  it('collapses the double separator left by an empty token in the middle', () => {
    expect(cleanSegment([tok('a'), lit('_'), tok(''), lit('_'), tok('c')], plain)).toBe('a_c');
  });
  it('returns an empty string when nothing is left', () => {
    expect(cleanSegment([tok(''), tok('')], plain)).toBe('');
  });
});

describe('cleanSegment: rules', () => {
  it('applies case and optional spaces-to-underscores', () => {
    expect(clean('hello wORLD_foo-bar', { caseMode: 'title' })).toBe('Hello World_Foo-Bar');
    expect(clean('Big Island', { spacesToUnderscores: true })).toBe('Big_Island');
  });
  it('replaces characters Windows forbids, on every OS', () => {
    expect(clean('AC/DC: Live?')).toBe('AC_DC_ Live_');
    expect(clean('a<b>c"d|e*f\u0001g')).toBe('a_b_c_d_e_f_g');
  });
  it('collapses runs of the same separator', () => {
    expect(clean('2024--07__04  x..y')).toBe('2024-07_04 x.y');
  });
  it('trims trailing dots and spaces', () => {
    expect(clean('name. . ')).toBe('name');
  });
  it('makes reserved Windows names safe', () => {
    expect(clean('CON')).toBe('CON_');
    expect(clean('nul.backup')).toBe('nul_.backup');
    expect(clean('CONSOLE')).toBe('CONSOLE');
  });
  it('normalizes to NFC', () => {
    expect(clean('Cafe\u0301')).toBe('Caf\u00e9');
  });
});

describe('helpers', () => {
  it('applyCase handles every mode', () => {
    expect(applyCase('Ab', 'none')).toBe('Ab');
    expect(applyCase('Ab', 'lower')).toBe('ab');
    expect(applyCase('Ab', 'upper')).toBe('AB');
  });
  it('isReservedWindowsName matches whole names only', () => {
    expect(isReservedWindowsName('com1')).toBe(true);
    expect(isReservedWindowsName('com10')).toBe(false);
  });
  it('utf8Bytes counts bytes, not characters', () => {
    expect(utf8Bytes('é')).toBe(2);
  });
  it('applyCase handles the sentence, snake, kebab and camel modes', () => {
    expect(applyCase('hello wORLD_foo-bar', 'sentence')).toBe('Hello world_foo-bar');
    expect(applyCase('Hawaii_2024-07-04 Beach', 'snake')).toBe('hawaii_2024_07_04_beach');
    expect(applyCase('Hawaii_2024-07-04 Beach', 'kebab')).toBe('hawaii-2024-07-04-beach');
    expect(applyCase('Hawaii_2024-07-04 Beach', 'camel')).toBe('hawaii20240704Beach');
    expect(applyCase('___', 'snake')).toBe('___');
  });
});

describe('stripDiacritics', () => {
  it('removes accents and expands special letters', () => {
    expect(stripDiacritics('Café Ñandú')).toBe('Cafe Nandu');
    expect(stripDiacritics('Straße Ærø Łódź Đông Þór ıspanak')).toBe('Strasse Aero Lodz Dong Thor ispanak');
    expect(stripDiacritics('Café')).toBe('Cafe');
  });
  it('leaves other scripts alone', () => {
    expect(stripDiacritics('日本語 photo')).toBe('日本語 photo');
  });
});

describe('asciiOnly', () => {
  it('replaces what is left outside printable ASCII with underscores', () => {
    expect(asciiOnly('日本語 Café')).toBe('___ Cafe');
    expect(asciiOnly('Émilie – 2024')).toBe('Emilie _ 2024');
  });
});

describe('cleanSegment: diacritics and ASCII', () => {
  it('strips accents before the case transform', () => {
    expect(clean('école dété', { stripDiacritics: true, caseMode: 'title' })).toBe('Ecole Dete');
  });
  it('makes a name ASCII only and collapses the underscores that leaves', () => {
    expect(clean('日本語 photo', { asciiOnly: true })).toBe('_ photo');
    expect(clean('Émilie – 2024', { asciiOnly: true, spacesToUnderscores: true })).toBe('Emilie_2024');
  });
});
