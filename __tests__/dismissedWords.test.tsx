/**
 * "I said it right" is permanent, so it has to be undoable: one word from the
 * mistakes sheet's undo bar, or all of them from Settings.
 */
const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockStore.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      mockStore.delete(k);
    }),
  },
}));

import { addDismissed, clearDismissed, loadDismissed, removeDismissed } from '../src/data/storage';

beforeEach(() => mockStore.clear());

describe('dismissed words', () => {
  it('forgets one word and keeps the rest', async () => {
    await addDismissed(10);
    await addDismissed(20);
    await removeDismissed(10);
    expect(await loadDismissed()).toEqual([20]);
  });

  it('does nothing for a word that was never dismissed', async () => {
    await addDismissed(10);
    await removeDismissed(99);
    expect(await loadDismissed()).toEqual([10]);
  });

  it('forgets every word at once', async () => {
    await addDismissed(10);
    await addDismissed(20);
    await clearDismissed();
    expect(await loadDismissed()).toEqual([]);
  });
});
