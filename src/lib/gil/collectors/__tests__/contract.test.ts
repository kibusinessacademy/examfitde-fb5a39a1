import { describe, it, expect } from 'vitest';
import {
  KNOWN_COLLECTOR_SOURCES,
  buildFingerprint,
  fingerprintHex,
  normalizeCollectorBatch,
  normalizeCollectorItem,
} from '../contract';

describe('GIL Collector Contract — pure', () => {
  it('exposes Cut-1 sources with manual_paste enabled and rss/semrush disabled', () => {
    const map = new Map(KNOWN_COLLECTOR_SOURCES.map((s) => [s.source_key, s]));
    expect(map.get('manual_paste')?.enabled).toBe(true);
    expect(map.get('competitor_paste')?.enabled).toBe(true);
    expect(map.get('rss')?.enabled).toBe(false);
    expect(map.get('semrush')?.enabled).toBe(false);
  });

  it('rejects reserved source keys (p18, manual)', () => {
    const r1 = normalizeCollectorItem('p18', { title: 'whatever' });
    const r2 = normalizeCollectorItem('manual', { title: 'whatever' });
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe('reserved_source');
    if (!r2.ok) expect(r2.reason).toBe('reserved_source');
  });

  it('rejects unknown sources and disabled sources', () => {
    const u = normalizeCollectorItem('does_not_exist', { title: 'x' });
    const d = normalizeCollectorItem('rss', { title: 'New release' });
    expect(u.ok).toBe(false);
    expect(d.ok).toBe(false);
    if (!u.ok) expect(u.reason).toBe('unknown_source');
    if (!d.ok) expect(d.reason).toBe('source_disabled');
  });

  it('rejects invalid titles and unknown signal_types', () => {
    const t = normalizeCollectorItem('manual_paste', { title: 'a' });
    const s = normalizeCollectorItem('manual_paste', {
      title: 'Valid Title',
      signal_type: 'serp_change',
    });
    expect(t.ok).toBe(false);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.reason).toBe('invalid_signal_type');
  });

  it('normalizes title, sanitizes secrets and url', () => {
    const r = normalizeCollectorItem('manual_paste', {
      title: '  Beobachtung über sk_live_ABC123 token   ',
      summary: 'Bearer eyJabcdefghijklmnopqrstuvwxyz123 leak',
      url: 'http://example.com/path',
      tags: ['Wettbewerb!', 'b2b', 'b2b'],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft.title).toContain('[redacted]');
      expect(r.draft.summary).toContain('[redacted]');
      expect(r.draft.url).toBe('http://example.com/path');
      expect(r.draft.tags).toEqual(['wettbewerb', 'b2b']);
      expect(r.draft.severity).toBe('info');
    }
  });

  it('competitor_paste defaults severity to warning and accepts pricing_change', () => {
    const r = normalizeCollectorItem('competitor_paste', {
      title: 'StudyFlix senkt Preis',
      signal_type: 'pricing_change',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.draft.severity).toBe('warning');
  });

  it('fingerprint is stable and prefers external_id > url > title+day', () => {
    const obs = '2026-05-23T10:00:00.000Z';
    const fpExt = buildFingerprint('manual_paste', { title: 't', external_id: 'rss-guid-1' }, obs);
    const fpExt2 = buildFingerprint('manual_paste', { title: 'X', external_id: 'rss-guid-1' }, obs);
    expect(fpExt).toBe(fpExt2);
    const fpUrl1 = buildFingerprint(
      'manual_paste',
      { title: 't', url: 'https://a.example/x' },
      obs,
    );
    const fpUrl2 = buildFingerprint(
      'manual_paste',
      { title: 'OTHER', url: 'https://a.example/x' },
      obs,
    );
    expect(fpUrl1).toBe(fpUrl2);
    const fpTitle1 = buildFingerprint('manual_paste', { title: 'Same Title' }, obs);
    const fpTitle2 = buildFingerprint('manual_paste', { title: 'same   title' }, obs);
    expect(fpTitle1).toBe(fpTitle2);
  });

  it('fingerprintHex is deterministic', () => {
    expect(fingerprintHex('abc')).toBe(fingerprintHex('abc'));
    expect(fingerprintHex('abc')).not.toBe(fingerprintHex('abd'));
  });

  it('batch normalize deduplicates within batch and reports rejects', () => {
    const r = normalizeCollectorBatch('manual_paste', [
      { title: 'Item A', external_id: 'a' },
      { title: 'Item A duplicate', external_id: 'a' }, // dup by external_id
      { title: 'a' }, // invalid title
      { title: 'Item B', signal_type: 'serp_change' }, // invalid signal_type
      { title: 'Item C' },
    ]);
    expect(r.drafts.length).toBe(2);
    expect(r.duplicates_in_batch).toBe(1);
    expect(r.rejected.length).toBe(2);
  });
});
