import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useEscapeKey } from './useDialogKeys.js';

interface PopoverProps {
  label: string;
  onClose(): void;
  /** Mouse-downs inside this element (usually the button that opened the popover) don't close it. */
  anchor?: RefObject<HTMLElement | null>;
  role?: 'dialog' | 'menu';
  style?: CSSProperties;
  children: ReactNode;
}

/** A small floating panel that closes on Escape or a mouse-down outside it and its anchor. */
export function Popover({ label, onClose, anchor, role = 'dialog', style, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEscapeKey(onClose);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor?.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose, anchor]);
  return (
    <div ref={ref} role={role} aria-label={label} className="popover" style={style}>
      {children}
    </div>
  );
}
