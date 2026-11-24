import { describe, expect, it, vi } from 'vitest';
import { createNotesService } from '../../api/_lib/notes-service.js';

const row = (version = 1) => ({
  note_id: 'note-1',
  user_id: 'user-1',
  title: 'Title',
  content: 'Body',
  version,
  updated_at: '2026-01-01T00:00:00.000Z',
});

describe('notes service', () => {
  it('requires a revision before updating', async () => {
    const repository = { find: vi.fn().mockResolvedValue(row()), update: vi.fn() };
    const service = createNotesService(repository);

    await expect(
      service.update({ userId: 'user-1', id: 'user-1', name: 'User' }, 'note-1', {}, null)
    ).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428 });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('uses the version in the atomic update guard', async () => {
    const repository = {
      find: vi.fn().mockResolvedValue(row()),
      update: vi.fn().mockResolvedValue(row(2)),
    };
    const service = createNotesService(repository);

    await service.update(
      { userId: 'user-1', id: 'actor-1', name: 'Actor' },
      'note-1',
      { content: 'Updated' },
      '1'
    );

    expect(repository.update).toHaveBeenCalledWith(
      'user-1',
      'note-1',
      expect.objectContaining({ content: 'Updated', updated_by: 'actor-1' }),
      { version: 1 }
    );
  });

  it('returns a conflict when the guarded update loses a race', async () => {
    const repository = {
      find: vi.fn().mockResolvedValueOnce(row()).mockResolvedValueOnce(row(2)),
      update: vi.fn().mockResolvedValue(null),
    };
    const service = createNotesService(repository);

    await expect(
      service.update(
        { userId: 'user-1', id: 'actor-1', name: 'Actor' },
        'note-1',
        { content: 'Updated' },
        '1'
      )
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT', status: 409 });
  });

  it('rejects update with non-numeric revision', async () => {
    const repository = { find: vi.fn().mockResolvedValue(row()), update: vi.fn() };
    const service = createNotesService(repository);

    await expect(
      service.update({ userId: 'user-1', id: 'u1', name: 'U' }, 'note-1', { content: 'x' }, 'abc')
    ).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428 });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('rejects update with empty string revision', async () => {
    const repository = { find: vi.fn().mockResolvedValue(row()), update: vi.fn() };
    const service = createNotesService(repository);

    await expect(
      service.update({ userId: 'user-1', id: 'u1', name: 'U' }, 'note-1', { content: 'x' }, '')
    ).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428 });
  });

  it('rejects update with NaN revision', async () => {
    const repository = { find: vi.fn().mockResolvedValue(row()), update: vi.fn() };
    const service = createNotesService(repository);

    await expect(
      service.update({ userId: 'user-1', id: 'u1', name: 'U' }, 'note-1', { content: 'x' }, 'not-a-number')
    ).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428 });
  });

  it('create generates noteId when input.noteId is empty', async () => {
    const repository = {
      find: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockResolvedValue(row()),
    };
    const service = createNotesService(repository);

    const result = await service.create(
      { userId: 'user-1', id: 'u1', name: 'U' },
      { title: 'Test', content: 'Body' }
    );
    expect(repository.insert).toHaveBeenCalled();
    const insertArg = repository.insert.mock.calls[0][0];
    expect(insertArg.note_id).toMatch(/^note-/);
  });

  it('create accepts custom noteId', async () => {
    const repository = {
      find: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockResolvedValue(row()),
    };
    const service = createNotesService(repository);

    await service.create(
      { userId: 'user-1', id: 'u1', name: 'U' },
      { noteId: 'custom-id', title: 'Test' }
    );
    const insertArg = repository.insert.mock.calls[0][0];
    expect(insertArg.note_id).toBe('custom-id');
  });

  it('create rejects duplicate noteId for active note', async () => {
    const existing = { ...row(), deleted_at: null };
    const repository = {
      find: vi.fn().mockResolvedValue(existing),
      insert: vi.fn(),
    };
    const service = createNotesService(repository);

    await expect(
      service.create({ userId: 'user-1', id: 'u1', name: 'U' }, { noteId: 'note-1' })
    ).rejects.toMatchObject({ code: 'NOTE_EXISTS', status: 409 });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('remove sets deleted_at timestamp', async () => {
    const repository = {
      find: vi.fn().mockResolvedValue(row()),
      update: vi.fn().mockResolvedValue({ ...row(), deleted_at: '2024-01-01T00:00:00Z' }),
    };
    const service = createNotesService(repository);

    await service.remove({ userId: 'user-1', id: 'u1', name: 'U' }, 'note-1', '1');

    const updateArg = repository.update.mock.calls[0][2];
    expect(updateArg.deleted_at).toBeDefined();
    expect(typeof updateArg.deleted_at).toBe('string');
  });

  it('get throws 404 for non-existent note', async () => {
    const repository = { find: vi.fn().mockResolvedValue(null) };
    const service = createNotesService(repository);

    await expect(
      service.get('user-1', 'nonexistent')
    ).rejects.toMatchObject({ code: 'NOTE_NOT_FOUND', status: 404 });
  });
});
