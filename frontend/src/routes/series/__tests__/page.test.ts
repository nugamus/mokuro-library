import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from '../[id]/+page.svelte';

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

vi.mock('$lib/stores/authStore', () => ({ user: userStore }));
vi.mock('$lib/services/api', () => ({
  apiFetch: apiFetchMock,
  triggerDownload: vi.fn()
}));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

afterEach(() => {
  apiFetchMock.mockReset();
  gotoMock.mockReset();
});

describe('series page', () => {
  it('loads and renders volume data', async () => {
    apiFetchMock.mockResolvedValueOnce({
      id: 'series-1',
      title: 'Test Series',
      folderName: 'Test Series',
      description: 'Series description',
      coverPath: null,
      bookmarked: false,
      createdAt: new Date().toISOString(),
      volumes: [
        {
          id: 'vol-1',
          title: 'Volume 1',
          folderName: 'Volume_1',
          sortTitle: 'Volume_1',
          pageCount: 10,
          createdAt: new Date().toISOString(),
          progress: [{ page: 1, completed: false, timeRead: 0, charsRead: 0, lastReadAt: null }]
        }
      ]
    });

    render(Page, { props: { params: { id: 'series-1' } } });

    expect(await screen.findByRole('heading', { name: /Volumes/ })).toBeTruthy();
    expect(screen.getByText('Volume 1')).toBeTruthy();
    expect(apiFetchMock).toHaveBeenCalledWith('/api/library/series/series-1', expect.any(Object));
  });
});
