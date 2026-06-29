import { describe, it, expect } from 'vitest';
import { buildCurriculumIndex, filterCurricula } from '@/lib/curriculumDisplay';

const RAW = [
  { id: 'a', title: 'Rahmenlehrplan Bankkaufmann' },                 // popularity 900
  { id: 'b', title: 'AEVO - Ausbildereignungsprüfung' },             // popularity 1000 (canonical AEVO)
  { id: 'c', title: 'Ausbildereignungsprüfung (AEVO)' },             // merges into b
  { id: 'd', title: 'Rahmenlehrplan Industriekaufmann' },            // popularity 950
  { id: 'e', title: 'Rahmenlehrplan Zerspanungsmechaniker' },        // popularity 0
  { id: 'f', title: 'Rahmenlehrplan Mechatroniker' },                // popularity 710
];

const index = buildCurriculumIndex(RAW);

const names = (rows: { display_name: string }[]) => rows.map((r) => r.display_name);

describe('curriculumDisplay sort options', () => {
  it('dedupes AEVO duplicates into a single canonical entry', () => {
    const aevoEntries = index.filter((c) => c.category === 'aevo');
    expect(aevoEntries).toHaveLength(1);
    expect(aevoEntries[0].display_name).toMatch(/AEVO/);
  });

  it('popularity sort puts AEVO (1000) before Industriekaufmann (950) before Bankkaufmann (900)', () => {
    const out = filterCurricula(index, { sort: 'popularity' });
    const order = names(out);
    expect(order.indexOf('AEVO – Ausbildereignungsprüfung')).toBeLessThan(order.indexOf('Industriekaufmann'));
    expect(order.indexOf('Industriekaufmann')).toBeLessThan(order.indexOf('Bankkaufmann'));
    // Last (popularity 0) should be Zerspanungsmechaniker
    expect(order[order.length - 1]).toBe('Zerspanungsmechaniker');
  });

  it('A–Z sort orders strictly by display_name ascending (German collation)', () => {
    const out = names(filterCurricula(index, { sort: 'az' }));
    const sorted = [...out].sort((a, b) => a.localeCompare(b, 'de'));
    expect(out).toEqual(sorted);
  });

  it('Z–A sort is the exact reverse of A–Z', () => {
    const az = names(filterCurricula(index, { sort: 'az' }));
    const za = names(filterCurricula(index, { sort: 'za' }));
    expect(za).toEqual([...az].reverse());
  });

  it('relevance sort surfaces recentIds first, then by popularity', () => {
    const out = names(
      filterCurricula(index, { sort: 'relevance', recentIds: ['e'] }),
    );
    // Zerspanungsmechaniker (id=e) is a recent → must be first even though pop=0.
    expect(out[0]).toBe('Zerspanungsmechaniker');
    // After recents, AEVO leads by popularity.
    expect(out[1]).toBe('AEVO – Ausbildereignungsprüfung');
  });

  it('relevance without recents falls back to popularity ordering', () => {
    const rel = names(filterCurricula(index, { sort: 'relevance' }));
    const pop = names(filterCurricula(index, { sort: 'popularity' }));
    expect(rel).toEqual(pop);
  });

  it('query filter applies regardless of sort and respects A–Z order', () => {
    const out = names(filterCurricula(index, { sort: 'az', query: 'kaufmann' }));
    expect(out).toEqual(['Bankkaufmann', 'Industriekaufmann']);
  });

  it('returns empty array when no curriculum matches query', () => {
    const out = filterCurricula(index, { query: 'xyz-nope-zzz' });
    expect(out).toEqual([]);
  });
});
