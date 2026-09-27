import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { previewUrl } from '../../src/core/preview.js';
import { PreviewPanel, type PreviewPanelProps } from '../../src/renderer/components/PreviewPanel.js';
import { createFakeApi } from './fakeApi.js';
import { row } from './fixtures.js';

function setup(over: Partial<PreviewPanelProps> = {}) {
  const api = createFakeApi();
  const props: PreviewPanelProps = {
    api,
    row: row({ path: '/photos/IMG_1.jpg', currentName: 'IMG_1.jpg', newName: 'Trip_001.jpg' }),
    platform: 'darwin',
    included: true,
    busy: false,
    width: 360,
    onWidth: vi.fn(),
    onToggle: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<PreviewPanel {...props} />);
  return { api, props };
}

describe('PreviewPanel', () => {
  it('shows the picture, both names and the file details', async () => {
    const { api } = setup();
    const img = screen.getByRole('img', { name: 'Preview of IMG_1.jpg' });
    expect(img).toHaveAttribute('src', previewUrl('/photos/IMG_1.jpg'));
    expect(screen.getByText('IMG_1.jpg')).toBeInTheDocument();
    expect(screen.getByText('Trip_001.jpg')).toBeInTheDocument();
    expect(await screen.findByText('4032 × 3024')).toBeInTheDocument();
    expect(screen.getByText('2.4 MB')).toBeInTheDocument();
    expect(screen.getByText('2024-07-04 14:30 (taken)')).toBeInTheDocument();
    expect(api.fileDetails).toHaveBeenCalledWith('/photos/IMG_1.jpg');
  });

  it('plays video and audio, muted and without autoplay', () => {
    setup({ row: row({ path: '/v/clip.mov', currentName: 'clip.mov' }) });
    const video = screen.getByLabelText('Preview of clip.mov') as HTMLVideoElement;
    expect(video.tagName).toBe('VIDEO');
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video).toHaveAttribute('preload', 'metadata');
  });

  it('says when there is no preview, or it could not be shown', () => {
    setup({ row: row({ path: '/n/notes.txt', currentName: 'notes.txt' }) });
    expect(screen.getByText('No preview for .txt files.')).toBeInTheDocument();
  });

  it('says so when the picture fails to load', () => {
    setup();
    fireEvent.error(screen.getByRole('img', { name: 'Preview of IMG_1.jpg' }));
    expect(screen.getByText("Couldn't show this file.")).toBeInTheDocument();
  });

  it('has no preview for folders', () => {
    setup({ row: row({ path: '/p/Trip.jpg', currentName: 'Trip.jpg', isDir: true }) });
    expect(screen.getByText('Folders have no preview.')).toBeInTheDocument();
  });

  it('unloads the file while a rename or undo runs', () => {
    setup({ busy: true });
    expect(screen.queryByRole('img', { name: 'Preview of IMG_1.jpg' })).toBeNull();
    expect(screen.getByText('The preview is paused while files are renamed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave out' })).toBeDisabled();
  });

  it('leaves the file out, or puts it back', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Leave out' }));
    expect(props.onToggle).toHaveBeenCalledWith(false);
  });

  it('shows a left-out file keeping its name, with Put back', async () => {
    const { props } = setup({ included: false });
    expect(screen.getByText('Left out, keeps its name')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Put back' }));
    expect(props.onToggle).toHaveBeenCalledWith(true);
  });

  it('shows the file in Finder and opens it, and reports a failure', async () => {
    const { api } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Show in Finder' }));
    expect(api.showInFolder).toHaveBeenCalledWith('/photos/IMG_1.jpg');
    vi.mocked(api.openFile).mockResolvedValueOnce('No application knows how to open it');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(api.openFile).toHaveBeenCalledWith('/photos/IMG_1.jpg');
    expect(await screen.findByRole('alert')).toHaveTextContent('No application knows how to open it');
  });

  it('closes from its button and with Escape', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open' }), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('resizes from its edge by dragging or with the arrow keys', () => {
    const { props } = setup();
    const edge = screen.getByRole('separator', { name: 'Resize preview panel' });
    fireEvent.keyDown(edge, { key: 'ArrowLeft' });
    expect(props.onWidth).toHaveBeenLastCalledWith(370);
    fireEvent.keyDown(edge, { key: 'ArrowRight' });
    expect(props.onWidth).toHaveBeenLastCalledWith(350);
    fireEvent.pointerDown(edge, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(edge, { clientX: 440, pointerId: 1 });
    fireEvent.pointerUp(edge, { pointerId: 1 });
    expect(props.onWidth).toHaveBeenLastCalledWith(420);
  });
});
