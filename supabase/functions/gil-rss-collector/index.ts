// P20 Cut 2 — GIL RSS / Web Collector
// Review-First: schreibt ausschließlich nach gil_signal_intake (status=pending).
// Niemals direkt nach gil_market_signals.
//
// Auth:
//   - Caller muss admin sein (Lovable Cloud Auth via getClaims + has_role).
//   - DB-Writes über Service Role Client.
//
// Limits:
//   - max 50 Items pro Feed pro Run
//   - 10s Timeout pro Feed
//   - nur http(s); private/localhost werden geblockt
//   - keine Secrets in Feed-Config; keine Raw-Feed-Dumps in Audit
//
// Audit:
//   - gil_rss_collector_run (1× pro Run)
//   - gil_rss_item_intaked   (1× pro inserted Item)
//   - gil_rss_source_failed  (1× pro fehlerhafter Feed)

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const PER_FEED_LIMIT = 50;
const FETCH_TIMEOUT_MS = 10_000;

// --- URL safety / canonicalization ----------------------------------------

const TRACKING_PREFIXES = ['utm_', 'mc_', '_hs'];
const TRACKING_EXACT = new Set([
  'gclid', 'fbclid', 'igshid', 'mkt_tok', 'ref', 'ref_src', 'spm', 'yclid', 'msclkid',
]);

function canonicalizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const t = input.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  let u: URL;
  try { u = new URL(t); } catch { return null; }
  const drop: string[] = [];
  u.searchParams.forEach((_v, k) => {
    const lk = k.toLowerCase();
    if (TRACKING_EXACT.has(lk) || TRACKING_PREFIXES.some((p) => lk.startsWith(p))) drop.push(k);
  });
  drop.forEach((k) => u.searchParams.delete(k));
  u.hash = '';
  return u.toString().slice(0, 500);
}

const PRIVATE_IPV4 = [/^10\./,/^127\./,/^169\.254\./,/^172\.(1[6-9]|2\d|3[0-1])\./,/^192\.168\./,/^0\./];
function isUnsafeFeedUrl(input: string): boolean {
  let u: URL;
  try { u = new URL(input); } catch { return true; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  const host = u.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '0.0.0.0') return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && PRIVATE_IPV4.some((re) => re.test(host))) return true;
  return false;
}

// --- Tiny RSS/Atom parser (no DOM, no deps) -------------------------------

interface ParsedItem { guid?: string; title: string; link?: string; summary?: string; published_at?: string; }

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '\"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
function strip(s: string): string { return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\s\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]).trim() : undefined;
}
function atomLink(block: string): string | undefined {
  const alt = block.match(/<link\b[^>]*\brel=["']?alternate["']?[^>]*\bhref=["']([^"']+)["']/i);
  if (alt) return alt[1];
  const any = block.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i);
  return any ? any[1] : undefined;
}
function tryIso(s?: string): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  return isNaN(t) ? undefined : new Date(t).toISOString();
}
function parseFeed(xml: string): { kind: 'rss'|'atom'|'unknown'; items: ParsedItem[] } {
  if (!xml) return { kind: 'unknown', items: [] };
  const isAtom = /<feed\b[\s\S]*?<entry\b/i.test(xml);
  const items: ParsedItem[] = [];
  if (isAtom) {
    const re = /<entry\b[\s\S]*?<\/entry>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const b = m[0];
      const title = strip(tag(b, 'title') ?? '');
      if (!title) continue;
      const sum = tag(b, 'summary') ?? tag(b, 'content');
      items.push({
        guid: tag(b, 'id'),
        title,
        link: atomLink(b),
        summary: sum ? strip(sum) : undefined,
        published_at: tryIso(tag(b, 'updated') ?? tag(b, 'published')),
      });
    }
    return { kind: 'atom', items };
  }
  const channel = xml.match(/<channel\b[\s\S]*?<\/channel>/i)?.[0] ?? xml;
  const re = /<item\b[\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(channel)) !== null) {
    const b = m[0];
    const title = strip(tag(b, 'title') ?? '');
    if (!title) continue;
    const desc = tag(b, 'description');
    items.push({
      guid: tag(b, 'guid'),
      title,
      link: tag(b, 'link'),
      summary: desc ? strip(desc) : undefined,
      published_at: tryIso(tag(b, 'pubDate') ?? tag(b, 'dc:date')),
    });
  }
  return { kind: 'rss', items };
}

// --- Normalization (mirror of contract.ts, server-side) ------------------

const SECRET_RE = /(sk_live|sk_test|bearer\s+[a-z0-9._-]+|eyJ[A-Za-z0-9._-]{20,})/gi;
function sanText(s: string | undefined, max: number): string {
  if (!s) return '';
  return s.replace(SECRET_RE, '[redacted]').trim().slice(0, max);
}
function sanTags(arr: readonly (string | null | undefined)[]): string[] {
  const out = arr
    .filter((x): x is string => !!x)
    .map((t) => t.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32))
    .filter((t) => t.length > 0);
  return Array.from(new Set(out)).slice(0, 8);
}
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}
function buildFingerprint(source_key: string, item: ParsedItem, observed_iso: string): string {
  if (item.guid?.trim()) return fnv1a(`${source_key}|ext|${item.guid.trim()}`);
  const url = canonicalizeUrl(item.link ?? null);
  if (url) return fnv1a(`${source_key}|url|${url}`);
  const day = observed_iso.slice(0, 10);
  const t = item.title.toLowerCase().replace(/\s+/g, ' ').trim();
  return fnv1a(`${source_key}|t|${t}|${day}`);
}

// --- Helpers --------------------------------------------------------------

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'ExamFit-GIL-RSSCollector/1.0', 'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8' },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

interface CollectorRunSummary {
  scanned_sources: number;
  fetched_items: number;
  inserted: number;
  skipped_duplicate: number;
  failed_sources: number;
  per_feed: Array<{ feed_id: string; label: string; fetched: number; inserted: number; duplicates: number; error?: string }>;
}

async function emitAudit(svc: any, action_type: string, ctx: Record<string, unknown>) {
  try {
    await svc.rpc('fn_emit_audit', {
      _action_type: action_type,
      _target_type: 'system',
      _target_id: null,
      _result_status: 'ok',
      _ctx: ctx,
    });
  } catch (_e) { /* swallow audit errors */ }
}

// --- Main handler ---------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const token = auth.replace(/^Bearer\s+/i, '');
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const userId = claims.claims.sub as string;

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: isAdmin } = await svc.rpc('has_role', { _user_id: userId, _role: 'admin' });
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const reason: string = String(body?.reason ?? '').trim();
  const onlyFeedId: string | undefined = body?.feed_id ? String(body.feed_id) : undefined;
  if (reason.length < 8) {
    return new Response(JSON.stringify({ error: 'reason_required', detail: 'reason must be at least 8 characters' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { data: src } = await svc.from('gil_signal_sources').select('source_key, enabled, allowed_signal_types, default_severity').eq('source_key', 'rss').maybeSingle();
  if (!src || !src.enabled) {
    return new Response(JSON.stringify({ error: 'rss_source_disabled' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const allowedTypes: string[] = src.allowed_signal_types ?? [];
  const defaultSeverity: string = src.default_severity ?? 'info';

  let feedsQ = svc.from('gil_rss_feeds').select('id, feed_url, label, category, default_signal_type, default_severity, tags, enabled');
  if (onlyFeedId) feedsQ = feedsQ.eq('id', onlyFeedId);
  else feedsQ = feedsQ.eq('enabled', true);
  const { data: feeds, error: feedsErr } = await feedsQ;
  if (feedsErr) {
    return new Response(JSON.stringify({ error: 'feeds_query_failed', detail: feedsErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const summary: CollectorRunSummary = {
    scanned_sources: 0,
    fetched_items: 0,
    inserted: 0,
    skipped_duplicate: 0,
    failed_sources: 0,
    per_feed: [],
  };

  for (const feed of feeds ?? []) {
    summary.scanned_sources++;
    const perFeed = { feed_id: feed.id as string, label: feed.label as string, fetched: 0, inserted: 0, duplicates: 0, error: undefined as string | undefined };

    if (isUnsafeFeedUrl(feed.feed_url)) {
      perFeed.error = 'unsafe_url';
      summary.failed_sources++;
      summary.per_feed.push(perFeed);
      await emitAudit(svc, 'gil_rss_source_failed', { feed_id: feed.id, feed_url: feed.feed_url, error: 'unsafe_url' });
      await svc.from('gil_rss_feeds').update({ last_run_at: new Date().toISOString(), last_run_result: { error: 'unsafe_url' } }).eq('id', feed.id);
      continue;
    }

    let xml = '';
    try {
      const res = await fetchWithTimeout(feed.feed_url, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`http_${res.status}`);
      xml = await res.text();
    } catch (e) {
      perFeed.error = (e as Error).message?.slice(0, 200) ?? 'fetch_failed';
      summary.failed_sources++;
      summary.per_feed.push(perFeed);
      await emitAudit(svc, 'gil_rss_source_failed', { feed_id: feed.id, feed_url: feed.feed_url, error: perFeed.error });
      await svc.from('gil_rss_feeds').update({ last_run_at: new Date().toISOString(), last_run_result: { error: perFeed.error } }).eq('id', feed.id);
      continue;
    }

    const parsed = parseFeed(xml);
    const items = parsed.items.slice(0, PER_FEED_LIMIT);
    perFeed.fetched = items.length;
    summary.fetched_items += items.length;

    const sigType: string = allowedTypes.includes(feed.default_signal_type) ? feed.default_signal_type : (allowedTypes[0] ?? 'press_mention');
    const sev: string = ['info','warning','critical'].includes(feed.default_severity) ? feed.default_severity : defaultSeverity;
    const baseTags: string[] = sanTags([...(feed.tags ?? []), feed.category, feed.label]);

    for (const it of items) {
      const observed_at = it.published_at ?? new Date().toISOString();
      const fingerprint = buildFingerprint('rss', it, observed_at);
      const url = canonicalizeUrl(it.link ?? null);
      const title = sanText(it.title, 200);
      if (title.length < 3) continue;
      const summaryText = sanText(it.summary, 600);

      const row = {
        source_key: 'rss',
        signal_type: sigType,
        severity: sev,
        title,
        summary: summaryText,
        url,
        external_id: it.guid ? sanText(it.guid, 200) : null,
        fingerprint,
        observed_at,
        status: 'pending',
        payload: {
          origin: 'rss',
          feed_id: feed.id,
          feed_label: feed.label,
          feed_kind: parsed.kind,
          tags: baseTags,
        },
      };

      const { data: inserted, error: insErr } = await svc
        .from('gil_signal_intake')
        .insert(row)
        .select('id')
        .maybeSingle();

      if (insErr) {
        if ((insErr as any).code === '23505') {
          perFeed.duplicates++;
          summary.skipped_duplicate++;
          continue;
        }
        perFeed.error = `db:${(insErr as any).code ?? 'err'}`;
        continue;
      }
      perFeed.inserted++;
      summary.inserted++;
      await emitAudit(svc, 'gil_rss_item_intaked', {
        feed_id: feed.id,
        intake_id: inserted?.id,
        fingerprint,
      });
    }

    await svc.from('gil_rss_feeds').update({
      last_run_at: new Date().toISOString(),
      last_run_result: {
        fetched: perFeed.fetched,
        inserted: perFeed.inserted,
        duplicates: perFeed.duplicates,
        error: perFeed.error ?? null,
        kind: parsed.kind,
      },
    }).eq('id', feed.id);

    summary.per_feed.push(perFeed);
  }

  await emitAudit(svc, 'gil_rss_collector_run', {
    scanned_sources: summary.scanned_sources,
    fetched_items: summary.fetched_items,
    inserted: summary.inserted,
    skipped_duplicate: summary.skipped_duplicate,
    failed_sources: summary.failed_sources,
    reason,
  });

  return new Response(JSON.stringify({ ok: true, summary }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
