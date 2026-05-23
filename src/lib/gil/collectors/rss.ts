/**
 * P20 Cut 2 — RSS / Atom Collector (PURE)
 *
 * Keine DB / kein Network. Nur reine Helfer:
 *   - canonicalizeUrl: entfernt Tracking-Parameter (utm_*, gclid, fbclid, mc_*, ref, ref_src, igshid, _hsenc, _hsmi)
 *   - isUnsafeFeedUrl: blockiert nicht-http(s), localhost, private IPv4/IPv6, link-local, .local mDNS
 *   - parseRssOrAtom: ohne DOM/XML-Lib — extrahiert <item> (RSS) oder <entry> (Atom)
 *   - mapFeedItemToRawCollectorItem: → CollectorRawItem (kompatibel mit normalizeCollectorItem)
 *
 * Limits:
 *   - max 50 Items pro Feed (caller enforced)
 *   - title/summary werden upstream sanitized (collector contract)
 */

import type { CollectorRawItem } from './contract';

// ---------------------------------------------------------------------------
// URL canonicalization
// ---------------------------------------------------------------------------

const TRACKING_PARAM_PREFIXES = ['utm_', 'mc_', '_hs'] as const;
const TRACKING_PARAM_EXACT = new Set([
  'gclid',
  'fbclid',
  'igshid',
  'mkt_tok',
  'ref',
  'ref_src',
  'spm',
  'yclid',
  'msclkid',
]);

export function canonicalizeUrl(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  // strip default ports
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
    u.port = '';
  }
  const drop: string[] = [];
  u.searchParams.forEach((_v, k) => {
    const lk = k.toLowerCase();
    if (TRACKING_PARAM_EXACT.has(lk)) drop.push(k);
    else if (TRACKING_PARAM_PREFIXES.some((p) => lk.startsWith(p))) drop.push(k);
  });
  drop.forEach((k) => u.searchParams.delete(k));
  // drop fragment
  u.hash = '';
  // normalize trailing slash on root path only (leave others)
  return u.toString().slice(0, 500);
}

// ---------------------------------------------------------------------------
// Feed URL safety
// ---------------------------------------------------------------------------

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^0\./,
];

export function isUnsafeFeedUrl(input: string): boolean {
  if (!input) return true;
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return true;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  const host = u.hostname.toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local')) return true;
  if (host === '::1' || host === '0.0.0.0') return true;
  // IPv6 private/link-local: fc00::/7, fe80::/10
  if (host.startsWith('[fc') || host.startsWith('[fd') || host.startsWith('[fe8') ||
      host.startsWith('fc') && host.includes(':') ||
      host.startsWith('fd') && host.includes(':') ||
      host.startsWith('fe8') && host.includes(':')) {
    return true;
  }
  // IPv4 dotted
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (PRIVATE_IPV4.some((re) => re.test(host))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// XML-light parsing (no DOM, no deps).
// Robust enough for well-formed RSS 2.0 + Atom feeds.
// ---------------------------------------------------------------------------

export interface ParsedFeedItem {
  guid?: string;
  title: string;
  link?: string;
  summary?: string;
  published_at?: string; // ISO
}

export interface ParsedFeed {
  kind: 'rss' | 'atom' | 'unknown';
  feed_title?: string;
  items: ParsedFeedItem[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(m[1]).trim() : undefined;
}

function extractAtomLink(block: string): string | undefined {
  // Prefer <link rel="alternate" .. href="..."/>; fallback to first <link href="...">
  const alt = block.match(/<link\b[^>]*\brel=["']?alternate["']?[^>]*\bhref=["']([^"']+)["']/i);
  if (alt) return alt[1];
  const any = block.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i);
  return any ? any[1] : undefined;
}

function tryIsoDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  if (isNaN(t)) return undefined;
  return new Date(t).toISOString();
}

export function parseRssOrAtom(xml: string): ParsedFeed {
  if (!xml || typeof xml !== 'string') return { kind: 'unknown', items: [] };
  const isAtom = /<feed\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(xml) ||
    /<feed\b[\s\S]*?<entry\b/i.test(xml);
  if (isAtom) {
    const feed_title = extractTag(xml, 'title');
    const entryRe = /<entry\b[\s\S]*?<\/entry>/gi;
    const items: ParsedFeedItem[] = [];
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(xml)) !== null) {
      const block = m[0];
      const title = stripTags(extractTag(block, 'title') ?? '');
      if (!title) continue;
      const summary =
        extractTag(block, 'summary') ?? extractTag(block, 'content') ?? undefined;
      items.push({
        guid: extractTag(block, 'id'),
        title,
        link: extractAtomLink(block),
        summary: summary ? stripTags(summary) : undefined,
        published_at: tryIsoDate(extractTag(block, 'updated') ?? extractTag(block, 'published')),
      });
    }
    return { kind: 'atom', feed_title, items };
  }
  // RSS 2.0
  const channel = xml.match(/<channel\b[\s\S]*?<\/channel>/i)?.[0] ?? xml;
  const feed_title = extractTag(channel, 'title');
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  const items: ParsedFeedItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(channel)) !== null) {
    const block = m[0];
    const title = stripTags(extractTag(block, 'title') ?? '');
    if (!title) continue;
    const desc = extractTag(block, 'description');
    items.push({
      guid: extractTag(block, 'guid'),
      title,
      link: extractTag(block, 'link'),
      summary: desc ? stripTags(desc) : undefined,
      published_at: tryIsoDate(extractTag(block, 'pubDate') ?? extractTag(block, 'dc:date')),
    });
  }
  return { kind: 'rss', feed_title, items };
}

// ---------------------------------------------------------------------------
// Map → CollectorRawItem (compatible with normalizeCollectorItem)
// ---------------------------------------------------------------------------

export interface MapOptions {
  default_signal_type?: string;
  feed_label?: string;
  category?: string;
  extra_tags?: readonly string[];
}

export function mapFeedItemToRawCollectorItem(
  item: ParsedFeedItem,
  opts: MapOptions = {},
): CollectorRawItem {
  const url = canonicalizeUrl(item.link ?? null) ?? undefined;
  const tagsRaw = [...(opts.extra_tags ?? []), opts.category, opts.feed_label].filter(
    (t): t is string => !!t && typeof t === 'string',
  );
  return {
    external_id: item.guid?.trim() || undefined,
    title: item.title,
    summary: item.summary ? item.summary.slice(0, 600) : undefined,
    url,
    observed_at: item.published_at,
    signal_type: opts.default_signal_type,
    tags: tagsRaw,
  };
}

export const RSS_PER_FEED_ITEM_LIMIT = 50;
export const RSS_FETCH_TIMEOUT_MS = 10_000;
