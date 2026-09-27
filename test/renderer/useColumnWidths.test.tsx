import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useColumnWidths } from '../../src/renderer/components/useColumnWidths.js';
import { WIDTHS_KEY } from '../../src/renderer/lib/columns.js';

describe('useColumnWidths', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('starts from what was saved, remembers a change and forgets it on reset', () => {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify([200, 400, 150, 120, 250]));
    const { result } = renderHook(() => useColumnWidths());
    expect(result.current[0]).toEqual([200, 400, 150, 120, 250]);

    act(() => result.current[1]([300, 400, 150, 120, 250]));
    expect(JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? 'null')).toEqual([300, 400, 150, 120, 250]);

    act(() => result.current[1](null));
    expect(result.current[0]).toBeNull();
    expect(localStorage.getItem(WIDTHS_KEY)).toBeNull();
  });

  it('starts with the default layout and still works when the page may not touch storage', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage is disabled', 'SecurityError');
      },
    });
    try {
      const { result } = renderHook(() => useColumnWidths());
      expect(result.current[0]).toBeNull();
      act(() => result.current[1]([200, 400, 150, 120, 250]));
      expect(result.current[0]).toEqual([200, 400, 150, 120, 250]);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });
});
