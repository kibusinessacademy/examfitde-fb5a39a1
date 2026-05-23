/**
 * P20 Cut 1 — GIL Collector Foundation (PURE)
 *
 * Pure contracts for external-signal intake. Kein DB-Zugriff, keine Side-Effects.
 *
 * Design-Prinzipien:
 *   - Review-First: Collector-Items landen in `gil_signal_intake` (status='pending'),
 *     NICHT direkt in `gil_market_signals`. Erst nach Admin-Approval wird ein
 *     Signal materialisiert.
 *   - Dedupe: deterministischer `fingerprint` aus (source_key, external_id|url|title+observed_day).
 *   - Whitelist: nur in `KNOWN_COLLECTOR_SOURCES` registrierte Sources erlaubt.
 *   - Bounded: kein Auto-Schreiben in produktive Strukturen, kein freier signal_type.
 *   - SSOT: kein zweites Audit-/Queue-System — Audits via fn_emit_audit, Persistenz
 *     via dedizierter SECURITY-DEFINER-RPCs.
 */

export type CollectorSourceKind = 'manual' | 'rss' | 'api';

export interface CollectorSource {
  /** Stable key, used as DB primary key. snake_case. */
  source_key: string;
  /** Human-readable label for UI. */
  label: string;
  kind: CollectorSourceKind;
  /** Whether intake is allowed. RSS/API sources stay `false` in Cut 1. */
  enabled: boolean;
  /** Whitelist of signal_type strings this source may emit. */
  allowed_signal_types: readonly string[];
  /** Default severity if item omits it. */
  default_severity: 'info' | 'warning' | 'critical';
  /** Notes for operators. */
  notes?: string;
}

/** Cut-1-Whitelist. RSS/API kommen erst in Cut 2/3. */
export const KNOWN_COLLECTOR_SOURCES: readonly CollectorSource[] = [
  {
    source_key: 'manual_paste',
    label: 'Manual Paste (Generic)',
    kind: 'manual',
    enabled: true,
    allowed_signal_types: ['manual_observation', 'press_mention', 'review_signal'],
    default_severity: 'info',
    notes: 'Operator-kuratiert. Beliebige Beobachtungen.',
  },
  {
    source_key: 'press_paste',
    label: 'Press / Mention Paste',
    kind: 'manual',
    enabled: true,
    allowed_signal_types: ['press_mention', 'campaign_change'],
    default_severity: 'info',
  },
  {
    source_key: 'competitor_paste',
    label: 'Competitor Observation Paste',
    kind: 'manual',
    enabled: true,
    allowed_signal_types: [
      'competitor_release',
      'pricing_change',
      'competitor_feature_added',
      'review_signal',
    ],
    default_severity: 'warning',
    notes: 'Wettbewerber-Pricing/Releases. Severity defaultet auf warning.',
  },
  {
    source_key: 'rss',
    label: 'RSS / Atom Collector',
    kind: 'rss',
    enabled: true,
    allowed_signal_types: ['press_mention', 'competitor_release'],
    default_severity: 'info',
    notes: 'P20 Cut 2 — review-first. Items land in gil_signal_intake.',
  },

  {
    source_key: 'semrush',
    label: 'Semrush API (planned)',
    kind: 'api',
    enabled: false,
    allowed_signal_types: ['serp_change', 'pricing_change'],
    default_severity: 'info',
    notes: 'Reserviert für Cut 3. In Cut 1/2 deaktiviert.',
  },
] as const;

export const COLLECTOR_SOURCE_KEYS = KNOWN_COLLECTOR_SOURCES.map((s) => s.source_key);

export function getCollectorSource(key: string): CollectorSource | undefined {
  return KNOWN_COLLECTOR_SOURCES.find((s) => s.source_key === key);
}

/** Reserved sources MUST NOT be used by collectors (collide with bridge/manual SSOT). */
export const RESERVED_SOURCE_KEYS = ['p18', 'manual'] as const;

// ---------------------------------------------------------------------------
// Raw → Normalized
// ---------------------------------------------------------------------------

export interface CollectorRawItem {
  /** External stable id from source (e.g. RSS guid). Optional. */
  external_id?: string;
  title: string;
  summary?: string;
  url?: string;
  /** ISO-8601. Defaults to "now" upstream. */
  observed_at?: string;
  /** Optional severity hint; clamped to allowed values. */
  severity?: string;
  /** Optional signal_type hint; must be in source.allowed_signal_types or rejected. */
  signal_type?: string;
  /** Free-form tags (sanitized to [a-z0-9_-], max 8 entries). */
  tags?: readonly string[];
}

export interface CollectorNormalizedDraft {
  source_key: string;
  signal_type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  summary: string;
  url: string | null;
  external_id: string | null;
  observed_at: string;
  fingerprint: string;
  tags: string[];
}

export type NormalizeResult =
  | { ok: true; draft: CollectorNormalizedDraft }
  | { ok: false; reason: NormalizeRejectReason; detail: string };

export type NormalizeRejectReason =
  | 'unknown_source'
  | 'source_disabled'
  | 'reserved_source'
  | 'invalid_title'
  | 'invalid_signal_type';

const SEVERITIES = new Set(['info', 'warning', 'critical']);

const SECRET_PATTERN = /(sk_live|sk_test|bearer\s+[a-z0-9._-]+|eyJ[A-Za-z0-9._-]{20,})/gi;

function sanitizeText(input: string | undefined | null, max: number): string {
  if (!input || typeof input !== 'string') return '';
  return input.replace(SECRET_PATTERN, '[redacted]').trim().slice(0, max);
}

function sanitizeUrl(input: string | undefined | null): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed.slice(0, 500);
}

function sanitizeTags(tags: readonly string[] | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  return Array.from(
    new Set(
      tags
        .map((t) => String(t).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32))
        .filter((t) => t.length > 0),
    ),
  ).slice(0, 8);
}

/** Stable, deterministic FNV-1a 32-bit hash → hex. Pure, no crypto dep. */
export function fingerprintHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

/** Build dedupe fingerprint. Prefer external_id, then url, then title+day-bucket. */
export function buildFingerprint(
  source_key: string,
  raw: CollectorRawItem,
  observed_at_iso: string,
): string {
  const ext = raw.external_id?.trim();
  if (ext) return fingerprintHex(`${source_key}|ext|${ext}`);
  const url = sanitizeUrl(raw.url ?? null);
  if (url) return fingerprintHex(`${source_key}|url|${url}`);
  const day = observed_at_iso.slice(0, 10);
  const titleNorm = (raw.title ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return fingerprintHex(`${source_key}|t|${titleNorm}|${day}`);
}

/** Pure normalization. No DB. Returns either a draft or a deterministic reject reason. */
export function normalizeCollectorItem(
  source_key: string,
  raw: CollectorRawItem,
): NormalizeResult {
  if (RESERVED_SOURCE_KEYS.includes(source_key as never)) {
    return { ok: false, reason: 'reserved_source', detail: source_key };
  }
  const src = getCollectorSource(source_key);
  if (!src) return { ok: false, reason: 'unknown_source', detail: source_key };
  if (!src.enabled) return { ok: false, reason: 'source_disabled', detail: source_key };

  const title = sanitizeText(raw.title, 200);
  if (title.length < 3) {
    return { ok: false, reason: 'invalid_title', detail: 'title ≥ 3 chars required' };
  }

  // signal_type: must be in source allowlist; falls back to first allowed.
  const requestedType = raw.signal_type?.trim();
  let signal_type: string;
  if (requestedType) {
    if (!src.allowed_signal_types.includes(requestedType)) {
      return {
        ok: false,
        reason: 'invalid_signal_type',
        detail: `${requestedType} not in [${src.allowed_signal_types.join(',')}]`,
      };
    }
    signal_type = requestedType;
  } else {
    signal_type = src.allowed_signal_types[0];
  }

  const severity =
    raw.severity && SEVERITIES.has(raw.severity)
      ? (raw.severity as 'info' | 'warning' | 'critical')
      : src.default_severity;

  const observed_at =
    raw.observed_at && !isNaN(Date.parse(raw.observed_at))
      ? new Date(raw.observed_at).toISOString()
      : new Date().toISOString();

  const fingerprint = buildFingerprint(source_key, raw, observed_at);

  return {
    ok: true,
    draft: {
      source_key,
      signal_type,
      severity,
      title,
      summary: sanitizeText(raw.summary, 600),
      url: sanitizeUrl(raw.url ?? null),
      external_id: raw.external_id ? sanitizeText(raw.external_id, 200) : null,
      observed_at,
      fingerprint,
      tags: sanitizeTags(raw.tags),
    },
  };
}

/** Batch helper; deduplicates by fingerprint within the batch. */
export interface BatchNormalizeResult {
  drafts: CollectorNormalizedDraft[];
  rejected: { index: number; reason: NormalizeRejectReason; detail: string }[];
  duplicates_in_batch: number;
}

export function normalizeCollectorBatch(
  source_key: string,
  items: readonly CollectorRawItem[],
): BatchNormalizeResult {
  const drafts: CollectorNormalizedDraft[] = [];
  const rejected: BatchNormalizeResult['rejected'] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  items.forEach((raw, idx) => {
    const r = normalizeCollectorItem(source_key, raw);
    if (!r.ok) {
      rejected.push({ index: idx, reason: r.reason, detail: r.detail });
      return;
    }
    if (seen.has(r.draft.fingerprint)) {
      duplicates++;
      return;
    }
    seen.add(r.draft.fingerprint);
    drafts.push(r.draft);
  });
  return { drafts, rejected, duplicates_in_batch: duplicates };
}
