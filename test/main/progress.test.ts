import { describe, expect, it } from 'vitest';
import { progressFraction } from '../../src/main/progress.js';

describe('progressFraction', () => {
  it('maps done/total to a fraction', () => {
    expect(progressFraction(1, 4)).toBe(0.25);
    expect(progressFraction(4, 4)).toBe(1);
  });

  it('clamps into [0, 1]', () => {
    expect(progressFraction(-1, 4)).toBe(0);
    expect(progressFraction(9, 4)).toBe(1);
  });

  it('clears the bar for an empty or nonsense total', () => {
    expect(progressFraction(0, 0)).toBe(-1);
    expect(progressFraction(1, Number.NaN)).toBe(-1);
  });
});
