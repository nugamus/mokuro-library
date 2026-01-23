import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from '../+page.svelte';

type SimpleStore<T> = {
  subscribe: (run: (value: T) => void) => () => void;
  set: (value: T) => void;
  update: (fn: (value: T) => T) => void;
};

const { userStore } = vi.hoisted(() => {
  let value: unknown = { id: 'user-1', username: 'tester', settings: {} };
  const subscribers = new Set<(value: unknown) => void>();
  const store: SimpleStore<unknown> = {
    subscribe(run) {
      run(value);
      subscribers.add(run);
      return () => subscribers.delete(run);
    },
    set(next) {
      value = next;
      subscribers.forEach((run) => run(value));
    },
    update(fn) {
      store.set(fn(value));
    }
  };
  return { userStore: store };
});

const apiFetchMock = vi.hoisted(() => vi.fn());
const gotoMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/services/api', () => ({
  apiFetch: apiFetchMock,
  triggerDownload: vi.fn()
}));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/stores/authStore', () => ({ user: userStore }));

afterEach(() => {
  apiFetchMock.mockReset();
  gotoMock.mockReset();
});

describe('contributions page', () => {
  it('renders empty state when no contributions exist', async () => {
    apiFetchMock.mockResolvedValue({ data: [] });

    render(Page);

    expect(await screen.findByText('All Caught Up!')).toBeTruthy();
    expect(apiFetchMock).toHaveBeenCalledWith('/api/contributions/rebase');
  });
});
