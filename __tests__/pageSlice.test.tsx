/**
 * Per-page slices (§5.7): the cursor moving one word must change the slice of
 * the ONE page it is on, and hand every other page back the object it already
 * had, so their memo holds.
 *
 * "Everything below the cursor reads as recited" used to reach the pages as a
 * raw `cursor` prop instead, which changed on every recognised word for every
 * mounted page, and each re-rendered all of its words.
 */
import { act, create } from 'react-test-renderer';

import { usePageSlice, type PageSlice } from '../src/hooks/usePageSlice';
import { pageWordRange } from '../src/data/quran';
import { initialSession, type SessionState } from '../src/engine/session';

let sliceFor: ((page: number) => PageSlice) | null = null;

function Probe({ session }: { session: SessionState }): null {
  sliceFor = usePageSlice(session);
  return null;
}

describe('recitedUpTo', () => {
  it('moves with the cursor on its own page and nowhere else', () => {
    const page = 50;
    const [from, to] = pageWordRange(page);
    const at = (cursor: number): SessionState => ({ ...initialSession(cursor), livePos: cursor });

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Probe session={at(from + 3)} />);
    });
    const before = { here: sliceFor!(page), behind: sliceFor!(page - 1), ahead: sliceFor!(page + 1) };
    expect(before.here.recitedUpTo).toBe(from + 3);
    // clamped: a page behind the cursor is wholly below it, a page ahead not at all
    expect(before.behind.recitedUpTo).toBe(pageWordRange(page - 1)[1]);
    expect(before.ahead.recitedUpTo).toBe(pageWordRange(page + 1)[0]);

    act(() => {
      tree.update(<Probe session={{ ...at(from + 3), cursor: from + 4 }} />);
    });
    expect(sliceFor!(page).recitedUpTo).toBe(from + 4);
    expect(sliceFor!(page)).not.toBe(before.here);
    expect(sliceFor!(page - 1)).toBe(before.behind);
    expect(sliceFor!(page + 1)).toBe(before.ahead);
    expect(to).toBeGreaterThan(from + 4);
    tree.unmount();
  });
});
