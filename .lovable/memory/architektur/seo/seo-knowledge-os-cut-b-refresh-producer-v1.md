---
name: SEO Knowledge OS Cut B — Refresh Queue Producer
description: Deterministic bridge producer from v_seo_content_node_ssot into the existing seo_refresh_queue. No new queue, no AI, idempotent per (content,reason,day).
type: feature
---

## Scope
Cut B aktiviert die bestehende `public.seo_refresh_queue`, ohne neue Queue/Tabelle/AI.

## Bausteine
- **Producer-RPC** `public.fn_enqueue_seo_refresh_candidates(_limit int default 50)` — service_role, SECURITY DEFINER. Quelle ausschließlich `v_seo_content_node_ssot`. Idempotent über `(content_type, content_id, reason, current_date)`.
- **Admin-Wrapper** `public.admin_enqueue_seo_refresh_candidates(_limit int)` — `has_role(auth.uid(),'admin')` Gate, gibt jsonb mit `scanned/enqueued/skipped_existing/by_reason/sample_nodes` zurück.
- **Reasons (5)**:
  - `canonical_recheck` — indexable + slug NULL/invalid (priority 2)
  - `indexability_recheck` — `is_indexable=false` + slug present (priority 3)
  - `stale_content` — indexable + slug + `updated_at < now()-90d` (priority 5)
  - `missing_structured_data` — indexable text-content nodes ohne `metadata.structured_data` (priority 6)
  - `missing_internal_links` — indexable narrative nodes + `updated_at < now()-30d` (priority 7)
- **Audit-Contract** `seo_refresh_queue_producer_run` (required: scanned, enqueued, skipped_existing) via `fn_emit_audit`.
- **Cron** `seo-refresh-queue-producer-daily` `41 3 * * *` ruft `fn_enqueue_seo_refresh_candidates(50)`.
- **UI** `src/components/admin/growth/SeoRefreshProducerCard.tsx` im Audit-Tab `/admin/v2/growth`. Manueller Trigger via Admin-RPC, Anzeige Queue-Status + letzte Producer-Runs.

## Guardrails
- Keine neue Queue, keine neue Content-Tabelle, keine AI-Augmentation.
- Producer-Output ausschließlich in `seo_refresh_queue`.
- Kein Client-Direktzugriff auf `seo_refresh_queue` über Schreibpfade — nur Lesezugriff für Status-Anzeige.
- Architecture Continuity Guard: `docs/examples/architecture-proposals/seo-refresh-producer-approved.json` (verdict=approved).

## Smoke 2026-05-23
- Run 1 (limit=10): scanned=3441, enqueued=10, skipped=0
- Run 2 (limit=10): enqueued=10 different rows, skipped_existing=10 (same-day dedup) → 0 Duplikate
- Queue: 20 pending, alle `canonical_recheck` (Top-Priority — 1058 indexable Cert/SEO-Pages mit fehlendem führendem `/`)

## Nächster Cut
Cut C: deklarativer Conversion Routing Layer auf Basis der frischen Refresh-Nodes.
