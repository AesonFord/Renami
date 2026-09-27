import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useEscapeKey, useFocusTrap } from '../../src/renderer/components/useDialogKeys.js';

function Layer({ label, onEscape }: { label: string; onEscape(): void }) {
  useEscapeKey(onEscape);
  return <span>{label}</span>;
}

function Harness({ outer, inner }: { outer(): void; inner(): void }) {
  const [innerOpen, setInnerOpen] = useState(false);
  return (
    <>
      <Layer label="outer" onEscape={outer} />
      <button type="button" onClick={() => setInnerOpen(true)}>
        Open inner
      </button>
      {innerOpen && (
        <Layer
          label="inner"
          onEscape={() => {
            inner();
            setInnerOpen(false);
          }}
        />
      )}
    </>
  );
}

function OrderHarness({ onA, onB }: { onA(): void; onB(): void }) {
  const [openB, setOpenB] = useState(false);
  const [openA, setOpenA] = useState(false);
  const [, forceRerender] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setOpenB(true)}>
        Open B
      </button>
      <button type="button" onClick={() => setOpenA(true)}>
        Open A
      </button>
      <button type="button" onClick={() => forceRerender((n) => n + 1)}>
        Force re-render
      </button>
      {/* B's onEscape is a fresh inline function every render, like a typical caller's
          onClose={() => setOpen(false)}; A's is a stable reference. */}
      {openB && <Layer label="B" onEscape={() => onB()} />}
      {openA && <Layer label="A" onEscape={onA} />}
    </>
  );
}

describe('useEscapeKey', () => {
  it('closes only the top (most recently opened) layer per Escape press', async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(<Harness outer={outer} inner={inner} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open inner' }));

    await userEvent.keyboard('{Escape}');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('ignores every key but Escape', async () => {
    const outer = vi.fn();
    render(<Harness outer={outer} inner={vi.fn()} />);
    await userEvent.keyboard('{Enter}{Tab}a');
    expect(outer).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('keeps stack order across a parent re-render, even when a caller passes a new inline callback each time', async () => {
    const onA = vi.fn();
    const onB = vi.fn();
    render(<OrderHarness onA={onA} onB={onB} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open B' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open A' }));
    await userEvent.click(screen.getByRole('button', { name: 'Force re-render' }));

    await userEvent.keyboard('{Escape}');
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).not.toHaveBeenCalled();
  });
});

function Trap({ onClose, autoFocusLast = false }: { onClose(): void; autoFocusLast?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div ref={ref} role="dialog" aria-label="Trap">
      <button type="button">First</button>
      <input aria-label="Middle" />
      <button type="button" autoFocus={autoFocusLast} onClick={onClose}>
        Last
      </button>
    </div>
  );
}

function TrapHarness({ autoFocusLast = false, closeMovesFocus = false }: { autoFocusLast?: boolean; closeMovesFocus?: boolean }) {
  const [open, setOpen] = useState(false);
  const elsewhere = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button" ref={elsewhere}>
        Elsewhere
      </button>
      {open && (
        <Trap
          autoFocusLast={autoFocusLast}
          onClose={() => {
            if (closeMovesFocus) elsewhere.current?.focus();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

describe('useFocusTrap', () => {
  const button = (name: string) => screen.getByRole('button', { name });

  it('focuses the first focusable element when the dialog opens', async () => {
    render(<TrapHarness />);
    await userEvent.click(button('Open'));
    expect(button('First')).toHaveFocus();
  });

  it('leaves focus where it is when the dialog already put it inside', async () => {
    render(<TrapHarness autoFocusLast />);
    await userEvent.click(button('Open'));
    expect(button('Last')).toHaveFocus();
    expect(button('First')).not.toHaveFocus();
  });

  it('wraps Tab from the last element to the first, and Shift+Tab from the first to the last', async () => {
    render(<TrapHarness />);
    await userEvent.click(button('Open'));
    await userEvent.tab();
    expect(screen.getByLabelText('Middle')).toHaveFocus();
    await userEvent.tab();
    expect(button('Last')).toHaveFocus();
    await userEvent.tab();
    expect(button('First')).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(button('Last')).toHaveFocus();
  });

  it('pulls focus back inside when Tab is pressed from outside the dialog', async () => {
    render(<TrapHarness />);
    await userEvent.click(button('Open'));
    button('Elsewhere').focus();
    expect(button('Elsewhere')).toHaveFocus();
    await userEvent.tab();
    expect(button('First')).toHaveFocus();
    button('Elsewhere').focus();
    await userEvent.tab({ shift: true });
    expect(button('Last')).toHaveFocus();
  });

  it('ignores keys other than Tab', async () => {
    render(<TrapHarness />);
    await userEvent.click(button('Open'));
    await userEvent.keyboard('{ArrowDown}');
    expect(button('First')).toHaveFocus();
  });

  it('gives focus back to what opened the dialog once it closes', async () => {
    render(<TrapHarness />);
    await userEvent.click(button('Open'));
    await userEvent.click(button('Last'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button('Open')).toHaveFocus();
  });

  it('does not take focus back when closing already moved it somewhere else', async () => {
    render(<TrapHarness closeMovesFocus />);
    await userEvent.click(button('Open'));
    await userEvent.click(button('Last'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button('Elsewhere')).toHaveFocus();
  });
});

function DetachedTrap() {
  // The ref is never attached, so there is nothing to trap.
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return <button type="button">Loose</button>;
}

function EmptyTrap() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div ref={ref} role="dialog" aria-label="Empty">
      Nothing here can take focus.
    </div>
  );
}

function OddHarness({ kind }: { kind: 'detached' | 'empty' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Elsewhere
      </button>
      {open && (kind === 'detached' ? <DetachedTrap /> : <EmptyTrap />)}
    </>
  );
}

describe('useFocusTrap without anything to trap', () => {
  const button = (name: string) => screen.getByRole('button', { name });

  it('does nothing when the ref was never attached', async () => {
    render(<OddHarness kind="detached" />);
    await userEvent.click(button('Open'));
    expect(button('Open')).toHaveFocus();
    await userEvent.tab();
    expect(button('Elsewhere')).toHaveFocus();
    await userEvent.click(button('Elsewhere'));
    expect(screen.queryByRole('button', { name: 'Loose' })).not.toBeInTheDocument();
    expect(button('Elsewhere')).toHaveFocus();
  });

  it('lets Tab move on when the dialog has no focusable element', async () => {
    render(<OddHarness kind="empty" />);
    await userEvent.click(button('Open'));
    expect(screen.getByRole('dialog', { name: 'Empty' })).toBeInTheDocument();
    expect(button('Open')).toHaveFocus();
    await userEvent.tab();
    expect(button('Elsewhere')).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(button('Open')).toHaveFocus();
  });

  it('lets Shift+Tab move backwards inside the dialog when not on the first element', async () => {
    render(<TrapHarness />);
    await userEvent.click(button('Open'));
    await userEvent.tab();
    expect(screen.getByLabelText('Middle')).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(button('First')).toHaveFocus();
  });
});

describe('useEscapeKey cleanup guard', () => {
  it('tolerates its stack entry having gone missing by the time it unmounts', async () => {
    // A fresh copy of the module, so the entry this test strands never reaches the other tests.
    vi.resetModules();
    const fresh = await import('../../src/renderer/components/useDialogKeys.js');
    function FreshLayer({ onEscape }: { onEscape(): void }) {
      fresh.useEscapeKey(onEscape);
      return null;
    }
    const first = vi.fn();
    const { unmount } = render(<FreshLayer onEscape={first} />);

    // Nothing public can take the entry out from under the hook, so make its lookup fail instead.
    const indexOf = Array.prototype.indexOf;
    const lookup = vi
      .spyOn(Array.prototype, 'indexOf')
      .mockImplementation(function (this: unknown[], item: unknown, from?: number) {
        return typeof item === 'function' ? -1 : indexOf.call(this, item, from);
      });
    try {
      expect(() => unmount()).not.toThrow();
    } finally {
      lookup.mockRestore();
    }

    // The stranded entry is still on the stack, so it keeps answering Escape until a newer
    // layer opens above it.
    await userEvent.keyboard('{Escape}');
    expect(first).toHaveBeenCalledTimes(1);
    const top = vi.fn();
    render(<FreshLayer onEscape={top} />);
    await userEvent.keyboard('{Escape}');
    expect(top).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });
});
