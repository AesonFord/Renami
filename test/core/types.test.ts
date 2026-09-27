import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/types.js';

describe('DEFAULT_SETTINGS', () => {
  it('has the expected defaults', () => {
    expect(DEFAULT_SETTINGS.sequence).toEqual({
      sortBy: 'dateTaken',
      direction: 'asc',
      start: 1,
      step: 1,
      digits: 3,
      restartPerFolder: false,
      restartEvery: 'never',
      keepGroupsTogether: true,
    });
    expect(DEFAULT_SETTINGS.cleanup).toEqual({
      caseMode: 'none',
      spacesToUnderscores: false,
      lowercaseExtension: false,
      stripDiacritics: false,
      asciiOnly: false,
      extensionRules: [],
    });
    expect(DEFAULT_SETTINGS.move.destinationRoot).toBeNull();
    expect(DEFAULT_SETTINGS.dates).toEqual({ setModified: false, setCreated: false, shiftMinutes: 0, useNameDate: true });
    expect(DEFAULT_SETTINGS.filter).toEqual({
      includeSubfolders: false,
      extensions: null,
      mode: 'files',
      name: { text: '', regex: false },
      minBytes: null,
      maxBytes: null,
      modifiedFrom: null,
      modifiedTo: null,
    });
  });
});
