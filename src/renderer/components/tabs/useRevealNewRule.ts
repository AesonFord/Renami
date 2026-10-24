import { useEffect, useRef } from 'react';

/**
 * Wraps an "+ Add" button's update: once the new rule renders, focuses its first field and scrolls the tab
 * panel to the bottom, so the rule, the button and anything after it show instead of being cut off.
 */
export function useRevealNewRule(count: number) {
  const input = useRef<HTMLInputElement>(null);
  const added = useRef(false);
  useEffect(() => {
    if (!added.current) return;
    added.current = false;
    input.current?.focus({ preventScroll: true });
    const panel = input.current?.closest('[role="tabpanel"]');
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [count]);
  const add = (addRule: () => void): void => {
    added.current = true;
    addRule();
  };
  return { input, add };
}
