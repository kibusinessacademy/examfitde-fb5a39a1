---
name: Phantom-Step Guard + Hidden/Hollow SSOT + Stale-Drafts Self-Heal
description: Trigger blockt queued/enqueued/pending_enqueue/running Steps auf published Paketen. v_hidden_hollow_ssot definiert beide Begriffe ausschließlich auf exam_questions. v_admin_stale_drafts_detection + admin_heal_stale_drafts ermöglichen Per-Paket-Heal direkt im Cockpit. admin_heal_playbook_run clustert + heilt automatisch.
type: feature
---

## Komponenten

- **Trigger `trg_guard_no_phantom_steps_on_published`** auf `package_steps` BEFORE INSERT/UPDATE: blockt queued/enqueued/pending_enqueue/running auf Paketen mit status='published'. Bypass via `session_replication_role='replica'` für Admin-Heals.
- **View `v_hidden_hollow_ssot`**: SSOT — basiert ausschließlich auf `exam_questions` (qc_status approved/draft/rejected). Cluster-Spalte: HOLLOW_PUBLISHED (status=published & approved=0), HIDDEN_DRAFTS (status≠published & drafts≥10 & approved<drafts), OK.
- **View `v_admin_stale_drafts_detection`**: Pakete mit ≥10 Drafts. Flags: STALE_HEAL_NEEDED (≥7d step-stale, 0 active jobs), STALE_WATCH (≥3d), OK.
- **RPC `admin_heal_stale_drafts(p_package_id)`**: Rejected Drafts >5d alt + requeue `run_integrity_check`. Audit `stale_drafts_self_heal`.
- **RPC `admin_heal_playbook_run(p_dry_run)`**: Cluster-Walk: HIDDEN_DRAFTS (per-pkg heal), HOLLOW_PUBLISHED (count), PHANTOM_PUBLISHED (auto-cleanup via session_replication_role), STALE_QUEUED (count, leave for staggered cron). Audit `heal_playbook_run`.

## UI

- **StaleDraftsCard** in HealCockpitPage Sektion 3 ("Pakete heilen"), nach HealStatusCard, vor ExamPoolDriftLogCard. Refetch 60s. Per-Klick Heal-Button (disabled bei active_jobs>0).

## Heal-Historie 2026-04-30

- 16 published Pakete x 87 phantom queued/pending_enqueue/running Steps via direct UPDATE + session_replication_role='replica' auf done gesetzt. Audit `phantom_cleanup_published_v1`.
- Stale Queued (358 Pakete, 4823 Steps): keine Direkt-Heilung — staggered_bulk_promote_cron läuft stündlich (WIP-Cap 80 → ~20 Pakete/h), Backlog löst sich in ~24h auf.
