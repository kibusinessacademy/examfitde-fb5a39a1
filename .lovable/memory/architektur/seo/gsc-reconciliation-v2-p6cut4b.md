---
name: P6 Cut 4b — GSC Reconciliation v2 (9-Decision-Taxonomie)
description: fn_classify_gsc_url_v2 + fn_path_in_sitemap + admin_reconcile_gsc_urls. Klassifiziert GSC-URLs on-the-fly gegen route_crawl_policy UND Sitemap-SSOT, ohne Vorab-Import. 9 Decisions inkl. valid_indexable / missing_from_sitemap / canonical_mismatch.
type: feature
---

# P6 Cut 4b — GSC Reconciliation v2

## Decision-Taxonomie (9)
- `valid_indexable` — Policy=index UND Pfad in Sitemap-SSOT UND GSC=indexed
- `expected_noindex` — Policy=noindex (GSC-Fund erwartet)
- `expected_redirect` — Policy=redirect (alter Pfad, Redirect korrekt)
- `expected_gone` — Policy=gone (bewusst entfernt)
- `missing_from_sitemap` — Policy=index ABER nicht in Sitemap-SSOT (echtes Gap)
- `unexpected_404` — GSC meldet 404, Policy ≠ gone/redirect
- `soft404_candidate` — GSC meldet soft_404 (Content-/Renderproblem)
- `canonical_mismatch` — Redirect/Canonical-Mismatch zwischen GSC und Policy
- `blocked_by_policy` — GSC sagt noindex/indexed, Policy widerspricht
- `unclassified_needs_fix` — Fallback (kein Policy-Match, kein Status)

## Komponenten
- **`fn_path_in_sitemap(_path)`** — Sitemap-Membership-Check über die 4 SSOT-Views
  (`v_paket_sitemap_entries.bezeichnung_kurz`, `v_blog_sitemap_entries.slug`,
  `v_wissen_sitemap_entries.path`, `v_pruefungstraining_sitemap_entries.slug`)
  + Fallback auf statische `route_crawl_policy` exact-rows mit state=index.
  STABLE SECURITY DEFINER, service_role only.
- **`fn_classify_gsc_url_v2(_path, _gsc_status)`** — Policy-Match
  (exact → longest-prefix → regex) × Sitemap-Membership × GSC-Status-Hint
  → (decision, matched_pattern, matched_state, redirect_to, in_sitemap,
  expected_action). Reihenfolge der Status-Prüfung: `soft_404` VOR `404`
  (sonst überdeckt 404-Regex soft_404). STABLE SECURITY DEFINER, service_role only.
- **`admin_reconcile_gsc_urls(_inputs jsonb, _source text)`** — has_role-gated.
  Akzeptiert `[{path|url, gsc_status?}, ...]`, normalisiert URLs auf Pfade,
  liefert `{input_count, summary, rows[]}`. Schreibt Audit
  `gsc_reconciliation_run` (Pflicht-Keys `input_count`, `summary`; Optional
  `source`). Keine externen API-Abhängigkeiten.

## Smoke (verifiziert 2026-05-21)
- `/product/test-alt` + `404` → `unexpected_404`
- `/paket/does-not-exist-xyz` + `indexed` → `missing_from_sitemap`
- `/blog/lerntipps` + `indexed` → `missing_from_sitemap`
- `/legal/impressum` + `noindex` (Policy=redirect) → `blocked_by_policy`
- `/some-deleted-page` + `404` → `unexpected_404`
- `/unknown/page` + `soft_404` → `soft404_candidate`

## Anti-patterns
- ❌ Klassifizierung im Client/Edge — SSOT ist `fn_classify_gsc_url_v2`.
- ❌ Direkter SELECT auf Sitemap-Views aus dem UI für GSC-Match — nur via RPC.
- ❌ `admin_reconcile_gsc_urls` ohne Audit aufrufen — Pflicht-Keys via
  `ops_audit_contract`.

## Nächster Cut
P6 Cut 5 — Admin SEO Cockpit Card mit Paste-Box (URLs + optional gsc_status),
Summary-Tiles über die 9 Decisions, Drilldown-Table, CSV-Export,
Hinweis-Button „GSC Validierung starten" (manueller Workflow).
