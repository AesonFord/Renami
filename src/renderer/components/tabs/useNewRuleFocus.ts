import { useEffect, useRef } from 'react';

/**
 * After an "+ Add" button adds a rule, focuses the new rule's first field and scrolls the tab panel
 * to the bottom, so the rule, the button and anything after it show instead of being cut off.
 */
export function useNewRuleFocus(count: number) {
  const input = useRef<HTMLInputElement>(null);
  const added = useRef(false);
  useEffect(() => {
    if (!added.current) return;
    added.current = false;
    input.current?.focus({ preventScroll: true });
    const panel = input.current?.closest('[role="tabpanel"]');
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [count]);
  const markAdded = (): void => {
    added.current = true;
  };
  return { input, markAdded };
}
