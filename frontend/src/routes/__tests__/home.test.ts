import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from '../+page.svelte';

type SimpleStore<T> = {
  subscribe: (run: (value: T) => void) => () => void;
  set: (value: T) => void;
  update: (fn: (value: T) => T) => void;
};

const { userStore } = vi.hoisted(() => {
  let value: unknown = null;
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
    },
  };
  return { userStore: store };
});

const apiFetchMock = vi.hoisted(() => vi.fn());
const gotoMock = vi.hoisted(() => vi.fn());
const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/') }));
vi.mock('$lib/services/api', () => ({
  apiFetch: apiFetchMock,
  triggerDownload: vi.fn(),
}));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('$lib/stores/authStore', () => ({ user: userStore }));

afterEach(() => {
  userStore.set(null);
  apiFetchMock.mockReset();
  gotoMock.mockReset();
});

describe('home page', () => {
  it('renders the login view by default', () => {
    render(Page);

    expect(screen.getByText('Welcome Back!')).toBeTruthy();
    expect(screen.getByLabelText('Username')).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  it('switches to register mode when toggled', async () => {
    render(Page);

    const toggleButton = screen.getByRole('button', { name: /create an account/i });
    await fireEvent.click(toggleButton);

    expect(screen.getByText('Join the Library!')).toBeTruthy();
    expect(screen.getByLabelText('Confirm Password')).toBeTruthy();
  });

  it('renders the library view and fetches data for authenticated users', async () => {
    vi.useFakeTimers();

    userStore.set({ id: 'user-1', username: 'tester', settings: {} });
    apiFetchMock.mockResolvedValue({
      data: [
        {
          id: 'series-1',
          title: 'Series One',
          folderName: 'Series One',
          coverPath: null,
          volumes: [],
        },
      ],
      meta: { total: 1, page: 1, limit: 24, totalPages: 1 },
    });

    render(Page);

    await vi.runAllTimersAsync();

    expect(apiFetchMock).toHaveBeenCalled();
    expect(screen.getByText('Series One')).toBeTruthy();

    vi.useRealTimers();
  });
});
