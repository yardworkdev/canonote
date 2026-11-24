import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import StorageMode from './StorageMode';

// The status row states a fact about storage. It stated the wrong fact while a
// browser was refusing every write, so each answer is pinned here.
describe('StorageMode', () => {
  beforeEach(() => {
    window.localStorage.getItem.mockImplementation(() => null);
    window.localStorage.setItem.mockImplementation(() => {});
    window.localStorage.removeItem.mockImplementation(() => {});
  });

  it('states where notes live when the browser stores them', async () => {
    render(<StorageMode />);

    expect(await screen.findByText('Stored in this browser')).toBeInTheDocument();
  });

  it('says notes are not being saved when the browser blocks storage', async () => {
    window.localStorage.setItem.mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    render(<StorageMode />);

    expect(
      await screen.findByText('Notes are not being saved — this browser blocks storage')
    ).toBeInTheDocument();
    expect(screen.queryByText('Stored in this browser')).toBeNull();
  });

  it('says storage is full when the browser refuses the write for space', async () => {
    window.localStorage.setItem.mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });

    render(<StorageMode />);

    expect(await screen.findByText('Notes are not being saved — storage is full')).toBeInTheDocument();
    expect(screen.queryByText('Stored in this browser')).toBeNull();
  });
});
