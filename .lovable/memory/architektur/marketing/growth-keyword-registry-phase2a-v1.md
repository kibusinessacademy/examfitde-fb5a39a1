---
name: Growth OS Phase 2A — Keyword SSOT
description: growth_keyword_registry mit Hard-Unique-Constraint pro keyword_slug (active). Admin-RPCs check/register/summary, SECURITY DEFINER + has_role-Gate. Companion-Guard scripts/guards/seo-cannibalization-guard.mjs (warn-only).
type: feature
---

# Growth OS Phase 2A — Keyword SSOT

## Tabelle
`public.growth_keyword_registry` — RLS enabled, REVOKE ALL FROM authenticated.
- `keyword_slug` (deterministisch via `fn_slugify_keyword`, vollständige Umlaut-Behandlung ä/ö/ü/ß → ae/oe/ue/ss)
- Hard-Unique: `UNIQUE(keyword_slug) WHERE status='active'` → verhindert Cannibalization auf DB-Ebene
- `persona`: azubi|betrieb|institution|generic
- `funnel_stage`: awareness|problem|comparison|exam_prep|purchase|retention|b2b|institutional
- `canonical_intent`: informational|navigational|transactional|commercial|definition|comparison|programmatic
- `owner_kind`: blog_article|seo_content_page|certification_seo_page|product_landing|money_page|reserved|other

## RPCs (SECURITY DEFINER + has_role)
- `admin_check_keyword_conflict(keyword)` → `(conflict, existing_id, slug, owner, url, status, registered_at)`
- `admin_register_keyword(keyword, persona, funnel_stage, canonical_intent, owner_kind, owner_id?, owner_url?, cluster_id?, notes?, force_takeover=false)` → jsonb
  - Bei Konflikt + `force_takeover=false` → `{ok:false, reason:'keyword_already_owned', ...}`
  - Bei `force_takeover=true` → vorhandener Owner wird `deprecated`
  - Audit immer in `auto_heal_log` (`action_type='growth_keyword_registered'`)
- `admin_get_keyword_registry_summary()` → counts pro persona × funnel_stage

## Guard (warn-only)
`scripts/guards/seo-cannibalization-guard.mjs` — scannt blog_articles.target_keyword + seo_content_pages.title + certification_seo_pages.meta_title + product_landing_profiles.seo_title.
Slugify mirror der DB-Funktion. CI: `.github/workflows/seo-cannibalization-guard.yml` (PR + daily 06 UTC).
- Default: exit 0 mit Report
- `--strict`: exit 1 bei Konflikten

## Baseline 2026-05-07
Erste Real-Scan: **10 Cannibalization-Konflikte** im Blog-Bestand (z.B. `pruefungsvorbereitung-rahmenlehrplan-steuerfachangestellter` mit 6 Ownern). Keine Auto-Fixes — Cleanup separater PR.

## Was NICHT in diesem PR
- Keine Programmatic-SEO-Generierung
- Kein Backfill bestehender Owner in Registry (manuelle Kuration zuerst)
- Kein UI-Cockpit (kommt in 2B mit Content-Graph)
- Kein Hard-Block (Strict-Mode opt-in)

## Phase 2B (geplant)
`growth_content_graph_nodes` + `growth_content_graph_edges` + `content-graph-orphan-guard.mjs`.

## Rollback
```sql
DROP TABLE public.growth_keyword_registry CASCADE;
DROP FUNCTION public.admin_register_keyword(text,text,text,text,text,uuid,text,uuid,text,boolean);
DROP FUNCTION public.admin_check_keyword_conflict(text);
DROP FUNCTION public.admin_get_keyword_registry_summary();
DROP FUNCTION public.fn_slugify_keyword(text);
```
