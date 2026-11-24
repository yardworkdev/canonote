import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dialog } from './dialog';

// Helper to flush microtasks so .then() callbacks resolve
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('dialog', () => {
  beforeEach(() => {
    dialog._register(null);
    dialog._drain('test-cleanup');
    dialog._register(null);
  });

  it('falls back to window.confirm when not registered', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const result = await dialog.confirm('Delete?');
    expect(result).toBe(true);
    expect(window.confirm).toHaveBeenCalledWith('Delete?');
    vi.unstubAllGlobals();
  });

  it('falls back to window.prompt when not registered', async () => {
    vi.stubGlobal('prompt', vi.fn(() => 'hello'));
    const result = await dialog.prompt('Enter text:');
    expect(result).toBe('hello');
    expect(window.prompt).toHaveBeenCalledWith('Enter text:', '');
    vi.unstubAllGlobals();
  });

  it('confirm returns true when _respond(true) is called', async () => {
    const setState = vi.fn();
    dialog._register(setState);

    const confirmPromise = dialog.confirm('OK?');
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState.mock.calls[0][0].type).toBe('confirm');

    dialog._respond(true);
    const val = await confirmPromise;
    expect(val).toBe(true);
  });

  it('confirm returns false when _respond(false) is called', async () => {
    const setState = vi.fn();
    dialog._register(setState);

    const confirmPromise = dialog.confirm('Cancel?');
    dialog._respond(false);
    const val = await confirmPromise;
    expect(val).toBe(false);
  });

  it('prompt returns the input string', async () => {
    const setState = vi.fn();
    dialog._register(setState);

    const promptPromise = dialog.prompt('URL?', { placeholder: 'https://' });
    expect(setState.mock.calls[0][0].type).toBe('prompt');
    expect(setState.mock.calls[0][0].placeholder).toBe('https://');

    dialog._respond('https://example.com');
    const val = await promptPromise;
    expect(val).toBe('https://example.com');
  });

  it('prompt returns null when cancelled', async () => {
    const setState = vi.fn();
    dialog._register(setState);

    const promptPromise = dialog.prompt('URL?');
    dialog._respond(null);
    const val = await promptPromise;
    expect(val).toBeNull();
  });

  it('queues concurrent confirms and processes them sequentially', async () => {
    const setState = vi.fn();
    dialog._register(setState);

    const p1 = dialog.confirm('First?');
    expect(setState).toHaveBeenCalledTimes(1);

    const p2 = dialog.confirm('Second?');
    expect(setState).toHaveBeenCalledTimes(1); // still queued

    // Respond to first — this clears state, then shows second
    dialog._respond(true);
    const val1 = await p1;
    expect(val1).toBe(true);

    // setState calls so far: firstItem, null(clear), secondItem = 3
    expect(setState).toHaveBeenCalledTimes(3);
    expect(setState.mock.calls[2][0].message).toBe('Second?');

    dialog._respond(false);
    const val2 = await p2;
    expect(val2).toBe(false);
    // After final respond: +1 null call = 4 total
    expect(setState).toHaveBeenCalledTimes(4);
  });

  it('_drain resolves all pending confirms as false', async () => {
    const setState = vi.fn();
    dialog._register(setState);

    const p1 = dialog.confirm('A?');
    const p2 = dialog.confirm('B?');
    const p3 = dialog.confirm('C?');

    dialog._drain('test');

    expect(await p1).toBe(false);
    expect(await p2).toBe(false);
    expect(await p3).toBe(false);
  });

  it('_drain resolves all pending prompts as null', async () => {
    const setState = vi.fn();
    dialog._register(setState);

    const p1 = dialog.prompt('A?');
    const p2 = dialog.prompt('B?');

    dialog._drain('test');

    expect(await p1).toBeNull();
    expect(await p2).toBeNull();
  });

  it('_drain clears the setState', () => {
    const setState = vi.fn();
    dialog._register(setState);

    dialog._drain('test');

    expect(setState).toHaveBeenLastCalledWith(null);
  });

  it('after _drain, new confirm falls back to window.confirm', async () => {
    const setState = vi.fn();
    dialog._register(setState);

    dialog._drain('test');
    dialog._register(null);

    vi.stubGlobal('confirm', vi.fn(() => true));
    const val = await dialog.confirm('After drain?');
    expect(val).toBe(true);
    vi.unstubAllGlobals();
  });

  it('confirm passes options through to the dialog item', () => {
    const setState = vi.fn();
    dialog._register(setState);

    dialog.confirm('Danger?', {
      title: 'Warning',
      confirmLabel: 'Do it',
      cancelLabel: 'Nope',
      variant: 'danger',
    });

    const item = setState.mock.calls[0][0];
    expect(item.title).toBe('Warning');
    expect(item.confirmLabel).toBe('Do it');
    expect(item.cancelLabel).toBe('Nope');
    expect(item.variant).toBe('danger');
  });

  it('prompt passes options through to the dialog item', () => {
    const setState = vi.fn();
    dialog._register(setState);

    dialog.prompt('Name?', {
      title: 'Enter name',
      placeholder: 'John',
      defaultValue: 'Doe',
      confirmLabel: 'Save',
    });

    const item = setState.mock.calls[0][0];
    expect(item.title).toBe('Enter name');
    expect(item.placeholder).toBe('John');
    expect(item.defaultValue).toBe('Doe');
    expect(item.confirmLabel).toBe('Save');
  });
});
