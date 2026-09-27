import { useEffect, useRef, type RefObject } from 'react';

// A stack of every mounted useEscapeKey's callback, in mount order. Only the top one — the most
// recently opened layer — responds to Escape, so closing one popover or dialog at a time doesn't
// also close whatever is behind it.
const escapeStack: (() => void)[] = [];
let escapeListenerAttached = false;

function onDocumentEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  escapeStack[escapeStack.length - 1]?.();
}

/** Calls onEscape when Escape is pressed, but only while this is the innermost open layer. */
export function useEscapeKey(onEscape: () => void): void {
  // Most callers pass a fresh inline function every render (e.g. onClose={() => setOpen(false)}).
  // Track the latest one in a ref so the stack entry below can stay put across re-renders instead
  // of being spliced out and pushed back on top merely because its identity changed.
  const ref = useRef(onEscape);
  ref.current = onEscape;

  useEffect(() => {
    const call = (): void => ref.current();
    escapeStack.push(call);
    if (!escapeListenerAttached) {
      document.addEventListener('keydown', onDocumentEscape);
      escapeListenerAttached = true;
    }
    return () => {
      const i = escapeStack.indexOf(call);
      if (i !== -1) escapeStack.splice(i, 1);
      if (escapeStack.length === 0 && escapeListenerAttached) {
        document.removeEventListener('keydown', onDocumentEscape);
        escapeListenerAttached = false;
      }
    };
    // Intentionally empty: the stack entry is pushed once on mount and removed once on unmount,
    // in open order, regardless of how many times onEscape's identity changes in between.
  }, []);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * Keeps Tab and Shift+Tab inside ref's element. On mount, focuses the first focusable element
 * unless focus is already inside. On unmount, gives focus back to whatever had it before.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>): void {
  // Captured while rendering, before this element commits (and before its own autoFocus, if any,
  // moves focus): document.activeElement is still whatever opened this dialog.
  const previous = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.contains(document.activeElement)) focusable(el)[0]?.focus();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const items = focusable(el);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const inside = el.contains(document.activeElement);
      if (e.shiftKey) {
        if (!inside || document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Only reclaim focus if it's still ownerless (the dialog's own focused element was just
      // removed from the DOM). If something else already moved focus elsewhere before this
      // cleanup ran — e.g. the action that closed the dialog also focused a different element —
      // leave it there instead of yanking focus back.
      if (document.activeElement === null || document.activeElement === document.body) previous.current?.focus();
    };
  }, [ref]);
}
