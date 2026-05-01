---
name: Council-Deferred Heal v1
description: Stop-the-Loop für quality_council STALE_WORKER_PATTERN_3X — Status-Fix + Anti-Loop-Trigger + Resolution-RPC + UI-Karte
type: feature
---

## Problem
fn_auto_defer_stale_council setzte package_steps.quality_council=skipped (Status-Misuse). auto_publish prüfte nur status='done' → crashte mit COUNCIL_CONSISTENCY → Heal-Cron retriggerte ~700×/Woche. 15 Pakete betroffen.

## Fix v1 (Migration 2026-05-01)
- **fn_auto_defer_stale_council v2**: skipped→failed + meta.review_required=true + cancelled offene auto_publish-Jobs + auto_heal_log Audit.
- **trg_block_auto_publish_while_council_deferred** BEFORE INSERT job_queue: blockt jeden neuen package_auto_publish solange council_defer_log.cleared_at IS NULL → RETURN NULL + Audit.
- **Backfill**: 15 Steps skipped→failed, alle offenen auto_publish-Jobs cancelled.
- **15 Permanent-Fix-Tasks** in heal_permanent_fix_tasks pattern_key='COUNCIL_DEFERRED_STALE_WORKER_3X'.
- **admin_resolve_council_deferred(p_package_id, p_action, p_reason)** SECURITY DEFINER + has_role: actions retry_council | force_pass | mark_content_gap (=archived+blocked_reason).
- **admin_get_council_deferred_overview()** für UI.
- **CouncilDeferredCard** in HealCockpit Sektion 3 (nach StaleDraftsCard).

## Schema-Realität
- heal_permanent_fix_tasks: title/description/notes/created_by NOT NULL, recommendation_id (NICHT recommendation).
- course_packages.status: planning|queued|building|done|archived|published|blocked (KEIN content_gap → mark_content_gap nutzt 'archived').
