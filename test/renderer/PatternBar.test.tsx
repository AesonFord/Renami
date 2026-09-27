import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PatternBar } from '../../src/renderer/components/PatternBar.js';
import type { TokenValues } from '../../src/shared/ipc.js';

function Harness({
  initial,
  error = null,
  extension = '.heic',
  loadTokenValues = async () => null,
}: {
  initial: string;
  error?: string | null;
  extension?: string;
  loadTokenValues?: () => Promise<TokenValues | null>;
}) {
  const [pattern, setPattern] = useState(initial);
  return (
    <PatternBar pattern={pattern} onChange={setPattern} extension={extension} error={error} loadTokenValues={loadTokenValues} />
  );
}

const input = () => screen.getByRole('textbox', { name: 'Name pattern' }) as HTMLInputElement;
const mirror = () => screen.getByTestId('pattern-mirror');

/** Puts the caret at `at` and clicks the input, as a user clicking inside the text would. */
function clickAt(at: number) {
  act(() => input().setSelectionRange(at, at));
  fireEvent.click(input());
}

/** Puts the caret at `at` and presses Enter, as a keyboard user would. */
function enterAt(at: number) {
  act(() => input().setSelectionRange(at, at));
  fireEvent.keyDown(input(), { key: 'Enter' });
}

describe('PatternBar', () => {
  it('highlights tokens and separators, and greys out the extension', () => {
    render(<Harness initial="{date_taken:YYYY}/Hawaii_{seq:3}" />);
    expect(within(mirror()).getByText('{date_taken:YYYY}')).toHaveClass('tok');
    expect(within(mirror()).getByText('/')).toHaveClass('pat-sep');
    expect(within(mirror()).getByText('{seq:3}')).toHaveClass('tok');
    expect(within(mirror()).getByText('.heic')).toHaveClass('pat-ext');
    expect(mirror()).toHaveTextContent('{date_taken:YYYY}/Hawaii_{seq:3}.heic');
  });

  it('marks an empty pattern invalid and says so, with no highlighted pieces', () => {
    render(<Harness initial="" extension="" />);
    expect(screen.getByRole('alert')).toHaveTextContent('The pattern is empty');
    expect(mirror()).toBeEmptyDOMElement();
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(input().closest('.pattern-field')).toHaveClass('invalid');
  });

  it('marks a pattern whose parse error is at the very first character', () => {
    render(<Harness initial="}x" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unexpected "}" at position 1');
    expect(within(mirror()).getByText('}x')).toHaveClass('pat-error');
  });

  it('underlines an invalid pattern and says what is wrong', async () => {
    render(<Harness initial="Trip_" />);
    await userEvent.type(input(), '{{nope}', { initialSelectionStart: 5, initialSelectionEnd: 5 });
    expect(input()).toHaveValue('Trip_{nope}');
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(within(mirror()).getByText('{nope}')).toHaveClass('pat-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Unknown token "{nope}"');
  });

  it('shows the main process error when the pattern itself parses', () => {
    render(<Harness initial="{name}" error="Find & replace rule 1: Invalid regular expression" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Find & replace rule 1: Invalid regular expression');
    expect(input()).toHaveAttribute('aria-invalid', 'false');
  });

  it('inserts a palette token at the cursor and puts the caret after it', async () => {
    render(<Harness initial="Trip_" />);
    act(() => input().setSelectionRange(5, 5));
    await userEvent.click(screen.getByRole('button', { name: 'Date taken' }));
    expect(input()).toHaveValue('Trip_{date_taken}');
    expect(input()).toHaveFocus();
    expect(input().selectionStart).toBe(17);
  });

  it('replaces selected text with the token', async () => {
    render(<Harness initial="Trip_001" />);
    act(() => input().setSelectionRange(5, 8));
    await userEvent.click(screen.getByRole('button', { name: 'Sequence' }));
    expect(input()).toHaveValue('Trip_{seq}');
  });

  it('groups the palette by kind', () => {
    render(<Harness initial="{name}" />);
    const toolbar = screen.getByRole('toolbar', { name: 'Insert a token' });
    for (const group of ['Dates', 'Number', 'File', 'Photo & video', 'Audio']) {
      expect(within(toolbar).getByText(group)).toBeInTheDocument();
    }
    for (const chip of ['Date taken', 'Created', 'Modified', 'Sequence', 'Name', 'Folder', 'Parent', 'Extension', 'Size', 'Camera', 'Lens', 'Aperture', 'Shutter', 'Artist', 'Album', 'Track', 'Composer']) {
      expect(within(toolbar).getByRole('button', { name: chip })).toBeInTheDocument();
    }
  });
});

describe('token popover', () => {
  it('opens for the token under the click and rewrites its format', async () => {
    render(<Harness initial="Trip_{date_taken}" />);
    clickAt(8);
    const popover = screen.getByRole('dialog', { name: 'Edit {date_taken}' });
    await userEvent.click(within(popover).getByRole('button', { name: 'YYYYMMDD' }));
    expect(within(popover).getByLabelText('Format')).toHaveValue('YYYYMMDD');
    await userEvent.click(within(popover).getByRole('button', { name: 'Apply' }));
    expect(input()).toHaveValue('Trip_{date_taken:YYYYMMDD}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not open when the click is outside every token', () => {
    render(<Harness initial="Trip_{seq}" />);
    clickAt(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens from the keyboard with Enter when the caret is in a token', () => {
    render(<Harness initial="Trip_{date_taken}" />);
    enterAt(8);
    expect(screen.getByRole('dialog', { name: 'Edit {date_taken}' })).toBeInTheDocument();
  });

  it('ignores Enter when the caret is outside every token', () => {
    render(<Harness initial="Trip_{seq}" />);
    enterAt(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says under the palette how to edit a token, for example to add the time', () => {
    render(<Harness initial="{created}" />);
    expect(screen.getByText(/Click a token in the name to change its format, for example to add the time/)).toBeInTheDocument();
  });

  it('offers Digits but no Default for {seq}', () => {
    render(<Harness initial="{seq}" />);
    clickAt(2);
    const popover = screen.getByRole('dialog', { name: 'Edit {seq}' });
    expect(within(popover).getByLabelText('Digits')).toBeInTheDocument();
    expect(within(popover).queryByLabelText('Default')).not.toBeInTheDocument();
  });

  it('offers both Digits and Default for {track}', () => {
    render(<Harness initial="{track}" />);
    clickAt(3);
    const popover = screen.getByRole('dialog', { name: 'Edit {track}' });
    expect(within(popover).getByLabelText('Digits')).toBeInTheDocument();
    expect(within(popover).getByLabelText('Default')).toBeInTheDocument();
  });

  it('checks digits and sets them', async () => {
    render(<Harness initial="{seq}" />);
    clickAt(2);
    const digits = screen.getByLabelText('Digits');
    await userEvent.type(digits, '12');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Digits must be a whole number from 1 to 10');
    await userEvent.clear(digits);
    await userEvent.type(digits, '4');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(input()).toHaveValue('{seq:4}');
  });

  it('drops a leftover default when Digits is applied to {seq}, since seq has no Default field', async () => {
    render(<Harness initial="{seq|x}" />);
    clickAt(2);
    const digits = screen.getByLabelText('Digits');
    await userEvent.type(digits, '4');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(input()).toHaveValue('{seq:4}');
  });

  it('sets a default for a text token and refuses characters that would break it', async () => {
    render(<Harness initial="{artist} - {title}" />);
    clickAt(3);
    const fallback = screen.getByLabelText('Default');
    await userEvent.type(fallback, 'A|B');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert')).toHaveTextContent("can't contain {, } or |");
    await userEvent.clear(fallback);
    await userEvent.type(fallback, 'Unknown Artist');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(input()).toHaveValue('{artist|Unknown Artist} - {title}');
  });

  it('removes a token', async () => {
    render(<Harness initial="Trip_{seq}" />);
    clickAt(7);
    await userEvent.click(screen.getByRole('button', { name: 'Remove token' }));
    expect(input()).toHaveValue('Trip_');
  });

  it('closes when the pattern is typed in', async () => {
    render(<Harness initial="Trip_{seq}" />);
    clickAt(7);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.change(input(), { target: { value: 'Trip_{seq}x' } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('All tokens', () => {
  const values: TokenValues = {
    fileName: 'IMG_4821.HEIC',
    values: {
      name: 'IMG_4821', folder: 'Hawaii 2024', date_taken: '2024-07-04', created: '2024-07-04', modified: '2024-08-01',
      seq: '001', camera_make: 'Apple', camera_model: 'iPhone 15', lens: null, iso: '50', focal_length: '6mm',
      width: '4032', height: '3024', gps_lat: '21.2766', gps_lon: '-157.8259', duration: null, artist: null,
      album_artist: null, album: null, title: null, genre: null, track: null, disc: null, year: null,
      ext: 'HEIC', parent: 'Photos', size: '2.1MB', size_bytes: '2097152', crc32: null, md5: null,
      aperture: 'f2.8', shutter: '1-250', fps: null, bitrate: null, composer: null,
    },
  };

  it("lists every token with the first file's value and inserts the one picked at the cursor", async () => {
    const load = vi.fn(async () => values);
    render(<Harness initial="Trip_" loadTokenValues={load} />);
    act(() => input().setSelectionRange(5, 5));
    await userEvent.click(screen.getByRole('button', { name: 'All tokens…' }));
    const dialog = screen.getByRole('dialog', { name: 'All tokens' });
    expect(await within(dialog).findByText('Values for IMG_4821.HEIC')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(35);

    await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Search tokens' }), 'camera');
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.click(within(dialog).getByRole('button', { name: /\{camera_model\}/ }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input()).toHaveValue('Trip_{camera_model}');
    expect(input()).toHaveFocus();
    expect(input().selectionStart).toBe(19);
  });

  it('says so when there are no files to show values for', async () => {
    render(<Harness initial="{name}" />);
    await userEvent.click(screen.getByRole('button', { name: 'All tokens…' }));
    expect(await screen.findByText('Add files to see their values.')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the button that opened it', async () => {
    render(<Harness initial="{name}" />);
    const opener = screen.getByRole('button', { name: 'All tokens…' });
    await userEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'All tokens' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

describe('token popover formats', () => {
  it('takes a typed date format and refuses characters that would break the token', async () => {
    render(<Harness initial="{date_taken}" />);
    clickAt(5);
    const format = screen.getByLabelText('Format');
    await userEvent.type(format, 'YYYY|MM');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert')).toHaveTextContent("can't contain {, } or |");
    expect(input()).toHaveValue('{date_taken}');

    await userEvent.clear(format);
    await userEvent.type(format, 'YYYY-MM');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(input()).toHaveValue('{date_taken:YYYY-MM}');
  });

  it("starts from the token's current format and drops it when the box is emptied", async () => {
    render(<Harness initial="{date_taken:YYYYMMDD}" />);
    clickAt(3);
    const format = screen.getByLabelText('Format');
    expect(format).toHaveValue('YYYYMMDD');
    await userEvent.clear(format);
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(input()).toHaveValue('{date_taken}');
  });

  it('refuses digits of 0 and accepts 10, the last allowed value', async () => {
    render(<Harness initial="{track}" />);
    clickAt(3);
    const digits = screen.getByLabelText('Digits');
    await userEvent.type(digits, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Digits must be a whole number from 1 to 10');
    await userEvent.clear(digits);
    await userEvent.type(digits, '10');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(input()).toHaveValue('{track:10}');
  });

  it("starts from the token's current default and keeps it alongside new digits", async () => {
    render(<Harness initial="{track|0}" />);
    clickAt(3);
    expect(screen.getByLabelText('Default')).toHaveValue('0');
    await userEvent.type(screen.getByLabelText('Digits'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(input()).toHaveValue('{track:2|0}');
  });
});

describe('all tokens dialog', () => {
  const values: TokenValues = {
    fileName: 'song.mp3',
    values: {
      name: 'song', folder: 'Music', date_taken: null, created: '2024-07-04 14:30', modified: '2024-07-04 14:30',
      seq: '1', camera_make: null, camera_model: null, lens: null, iso: null, focal_length: null, width: null,
      height: null, gps_lat: null, gps_lon: null, duration: '3m05s', artist: null, album_artist: null, album: 'Album',
      title: 'Song', genre: null, track: '3', disc: null, year: '2024',
      ext: 'mp3', parent: 'Music', size: '5.2MB', size_bytes: '5452595', crc32: null, md5: null,
      aperture: null, shutter: null, fps: null, bitrate: '320', composer: null,
    },
  };

  async function open(load: () => Promise<TokenValues | null>) {
    render(<Harness initial="{name}" loadTokenValues={load} />);
    await userEvent.click(screen.getByRole('button', { name: 'All tokens…' }));
    return screen.getByRole('dialog', { name: 'All tokens' });
  }

  it('says it is loading until the values arrive, then shows "No value" for tokens the file lacks', async () => {
    let resolve!: (v: TokenValues | null) => void;
    const dialog = await open(() => new Promise((r) => (resolve = r)));
    expect(within(dialog).getByText('Loading values…')).toBeInTheDocument();
    await act(async () => resolve(values));
    expect(within(dialog).getByText('Values for song.mp3')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /\{artist\}/ })).toHaveTextContent('No value');
    expect(within(dialog).getByRole('button', { name: /\{album\}/ })).toHaveTextContent('Album');
  });

  it('searches by label as well as by token name, ignoring case and surrounding spaces', async () => {
    const dialog = await open(async () => values);
    const search = within(dialog).getByRole('searchbox', { name: 'Search tokens' });
    await userEvent.type(search, ' Sequence ');
    expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('{seq}')]);
    await userEvent.clear(search);
    await userEvent.type(search, 'GPS');
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.clear(search);
    await userEvent.type(search, 'no such token');
    expect(within(dialog).queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('closes on a press on the backdrop, but not on one inside the dialog', async () => {
    const dialog = await open(async () => values);
    fireEvent.mouseDown(dialog);
    expect(screen.getByRole('dialog', { name: 'All tokens' })).toBeInTheDocument();
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes from its Close button without inserting anything', async () => {
    const dialog = await open(async () => values);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input()).toHaveValue('{name}');
  });
});
