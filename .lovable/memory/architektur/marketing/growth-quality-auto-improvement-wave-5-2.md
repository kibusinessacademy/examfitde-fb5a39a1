---
name: Welle 5.2 — Funnel/CTA Foundation-Bridge + Fail-Closed Gate
description: growth-quality-repair-worker fährt CTA + funnel_events über fn_growth_repair_start_run/complete_run. Fail-Closed bei post_score IS NULL. Subscore-Lookup nutzt v_scores->'subscores'->>subscore.
type: feature
---

## Was

- `fn_growth_repair_complete_run`: bei `requires_pre_post_score=true` und `post_score IS NULL` → `rolled_back` (`reason=post_score_unavailable`). Kein silent-pass mehr.
- `fn_growth_repair_start_run` + `fn_growth_repair_complete_run` lesen Score über `v_scores->'subscores'->>subscore` (mit Fallback auf `score_<key>` und `<key>`).
- Module `cta` + `funnel_events` aktiviert (`enabled=true`, `audit_only`, kein Council).
- `growth-quality-repair-worker` (Edge) ruft pro Job: `start_run` → Audit-RPC (`fn_audit_growth_cta` / `fn_audit_growth_funnel`) → `complete_run`. job_queue mirrors run_status (completed/failed). Audit in `auto_heal_log` (`growth_quality_repair_worker`, wave=5.2).

## Smoke (2026-05-11)

- Pre-Fix: 2 Audit-Jobs → beide `rolled_back` mit `post_score_unavailable` (Score-Lookup-Pfad falsch).
- Post-Fix: 2 Audit-Jobs → beide `completed` (pre=0, post=0 aus `subscores`).
- Council-Fail (seo_meta, score=60) → `rolled_back` reason `council_below_bronze 60`.

## Nicht-Ziel

Keine Content-Mutation. AI-Module (blog/seo/email/internal_links/og_image/distribution) bleiben `enabled=false`.
