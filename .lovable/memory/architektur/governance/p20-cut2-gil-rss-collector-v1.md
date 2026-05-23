---
name: P20 Cut 2 — GIL RSS / Web Collector v1
description: Review-First RSS/Atom Collector. gil_rss_feeds Registry + gil-rss-collector Edge (admin-gated, service-role writes), schreibt nur in gil_signal_intake. URL-Canonicalization (utm/gclid/fbclid raus), Private/Localhost-Block, max 50 Items/Feed, 10s Timeout. Keine Auto-Approve, kein Cron, semrush bleibt disabled.
type: feature
---

# P20 Cut 2 — RSS / Web Collector

**Status:** live · 2026-05-23

## SSOT
- `gil_rss_feeds` (Registry, UNIQUE feed_url, default_signal_type ∈ rss-allowed, default_severity)
- Trigger `trg_guard_gil_rss_feed_url_safe` blockt localhost / private IPv4 / `.local` / `.localhost` auf DB-Layer
- Source `rss` in `gil_signal_sources` ist `enabled=true`; semrush bleibt `enabled=false`

## Pure (testbar)
`src/lib/gil/collectors/rss.ts`:
- `canonicalizeUrl` — strip `utm_*`, `mc_*`, `_hs*`, `gclid`, `fbclid`, `igshid`, `mkt_tok`, `ref`, `ref_src`, `spm`, `yclid`, `msclkid`, fragments, default-ports
- `isUnsafeFeedUrl` — blockt non-http(s), localhost, `*.local`, `*.localhost`, 127/10/192.168/172.16-31/169.254/0.x, IPv6 `::1`
- `parseRssOrAtom` — DOM-frei, FNV-1a-frei; entkoppelt von Edge-Runtime
- `mapFeedItemToRawCollectorItem` — kompatibel mit `normalizeCollectorItem('rss', …)`
- `RSS_PER_FEED_ITEM_LIMIT = 50`, `RSS_FETCH_TIMEOUT_MS = 10000`

## Edge `supabase/functions/gil-rss-collector`
- Auth: Bearer-JWT → `getClaims` → `has_role(uid,'admin')`. Kein `verify_jwt`-Override, kein Service-Role-Bypass.
- Body: `{ reason: string >=8, feed_id?: uuid }`
- Pro Run lädt entweder den 1 Feed (`feed_id`) oder alle `enabled=true`
- Pro Feed: `isUnsafeFeedUrl`-Check → fetchWithTimeout(10s, AbortController) → `parseFeed` → max 50 Items → fingerprint (FNV-1a; ext_id > url > title+day) → `gil_signal_intake.insert` mit `status='pending'`, `payload.origin='rss'`, `payload.feed_id`, `payload.feed_kind`, `payload.tags`
- Dedupe via vorhandenem `uq_gil_signal_intake_fp_active`; `23505` → `skipped_duplicate`
- Update `gil_rss_feeds.{last_run_at,last_run_result}` pro Feed
- **Schreibt NIE in `gil_market_signals`** — Promotion ausschließlich via `admin_gil_intake_decide` (Cut 1)

## Admin RPCs (alle SECURITY DEFINER + has_role admin + reason ≥ 8)
- `admin_gil_list_rss_feeds()` — UI-Liste
- `admin_gil_add_rss_feed(p_feed_url, p_label, p_category, p_default_signal_type, p_tags, p_reason)` — `default_signal_type` muss in `gil_signal_sources.allowed_signal_types` für `rss` sein. DB-Trigger erzwingt URL-Sicherheit zusätzlich.
- `admin_gil_set_rss_feed_enabled(p_feed_id, p_enabled, p_reason)`

## Audit-Contracts (ops_audit_contract)
- `gil_rss_collector_run` [scanned_sources, fetched_items, inserted, skipped_duplicate, failed_sources, reason]
- `gil_rss_item_intaked` [feed_id, intake_id, fingerprint]
- `gil_rss_source_failed` [feed_id, feed_url, error]
- Keine Raw-Feed-Dumps. Title/Summary durch SECRET_RE redacted (sk_live, sk_test, bearer …, eyJ…).

## UI
- `RssCollectorCard` als oberste Karte im Tab "Collector Intake" (`/admin/growth`)
- Reason-Pflicht für Run / Feed-Toggle / Feed-Anlage
- Buttons: „RSS Collector starten (alle aktiven Feeds)", per-Feed „Nur diesen Feed laufen lassen", Feed-Anlage Inline-Form
- Letzte-Run-Summary inkl. per-Feed Counts und error-string
- **Kein Auto-Approve-Button**. Pending-Items erscheinen in der bestehenden Pending-Review-Liste.

## Bewusst NICHT in Cut 2
- Kein pg_cron — Trigger ist manuell / UI
- Keine Auto-Approve-Regeln
- Keine Semrush/LinkedIn-API (semrush bleibt disabled, Cut 3)
- Keine Secrets in Feed-Config
- Keine HTML-Ausführung; nur Tag-Strip
- Keine direkten `gil_market_signals`-Writes vom Collector

## Tests
25/25 grün:
- rss.test.ts (7): canonicalizeUrl strip+keep, non-http reject, isUnsafeFeedUrl localhost/.local/127/10/192.168/172.16/169.254/file, parseRssOrAtom RSS+Atom, mapFeedItemToRawCollectorItem normalize-kompatibel, RSS_PER_FEED_ITEM_LIMIT=50
- contract.test.ts (9, Cut-2-aktualisiert): rss/competitor_paste/manual_paste enabled, semrush disabled
- contracts.test.ts (8, P19) + client.test.ts (1, paste-parser)

## SSOT-Wahrung
- nutzt vorhandene `gil_signal_intake` als Senke (kein Parallelsystem)
- nutzt vorhandene Decide-RPC als einzigen Promotion-Pfad
- nutzt vorhandene `fn_emit_audit` + `ops_audit_contract`
- `gil_market_signals.source='rss'` taucht nur als Resultat eines admin-approved Intake-Items auf (payload.origin='intake')
