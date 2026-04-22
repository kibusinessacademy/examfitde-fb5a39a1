---
name: Action-First Cockpit & Auto-Heal Engine v5
description: Wave-5 — Hybrid Action-First UI (kompakter Health-Header → priorisierte Aktionsliste mit Risk-Tags) + 4-Cluster Auto-Heal-Engine (STALE_LOCK/REPAIR_COMPETENCY/REQUEUE_LOOP/UNCLASSIFIED) mit 1-Klick-Heal-RPCs.
type: feature
---

## UX-Prinzip

Der Admin darf NIEMALS nachdenken müssen, wo er klicken soll.

**Hybrid-Layout** (Action-First, nicht Dashboard-First):
1. **Kontext-Header** (kompakt, nicht dominant) — Health-Score 0-100 + Status-Badge + Failed/Active/Critical-Counts
2. **Empfohlene Aktionen** (PRIMARY INTERFACE) — priorisierte Liste mit Risk-Badges (SAFE/LOW/MEDIUM/HIGH), 1-Klick für SAFE/LOW, Bestätigungsdialog für MEDIUM/HIGH, "Empfohlen vom System"-Hint auf Top-Aktion
3. **Drilldown** (collapsible) — bestehender QueueHealthDashboard mit Root-Causes/Audit-Log
4. **Live-Liste** (Default-Detail) — Job-by-Job View für Deep-Debug

## Backend-Stack

### Klassifizierung gehärtet (`fn_classify_job_error`)
19 Cluster (vorher 12), case-insensitive Pattern, Network/Auth/Budget/Parse/DB-Constraint zusätzlich. Erwartung: UNCLASSIFIED <5%.

### Auto-Heal-Engine (`fn_auto_heal_failed_clusters`)
Per-Row Exception-Isolation, alle Cluster mit Active-Status-Guard via `fn_job_active_statuses()`:
- **STALE_LOCK_LOOP_HARD_KILL** (SAFE) → reset auf pending + attempt-decrement
- **REPAIR_COMPETENCY_COVERAGE** (MEDIUM) → cancel + enqueue `targeted_competency_fill`
- **REQUEUE_LOOP_KILLED** (HIGH) → terminal markieren + admin_notification
- **UNCLASSIFIED/OTHER** (LOW) → reklassifizieren gegen meta+error, dann Soft-Retry

### RPCs (admin-gated)
- `admin_get_queue_health_score()` → `{score, status, failed, processing, pending, total_active, critical_clusters, terminal_count}`
- `admin_recommend_queue_actions()` → priorisierte Liste mit `action_key`, `risk_level`, `is_safe`, `title`, `description`, `recommended_strategy`
- `admin_execute_recommended_action(_action_key, _max_jobs)` → throttled (10/min), routet zur passenden Heal-Strategie

## Risk-Levels & Buttons
| Risk   | Button-Variant | Verhalten |
|--------|----------------|-----------|
| SAFE   | default+Zap    | 1-Klick-Heal sofort |
| LOW    | default+Zap    | 1-Klick-Heal sofort |
| MEDIUM | outline+Warn   | Bestätigungsdialog |
| HIGH   | outline+Warn   | Bestätigungsdialog mit Risiko-Hinweis |

## Files
- `supabase/migrations/2026042210xxxx_action_first_cockpit_v5.sql`
- `src/components/admin/queue/QueueActionCockpit.tsx` — neue Hybrid-UI
- `src/pages/admin/v2/QueuePage.tsx` — Layout-Reorder, alter Dashboard wird collapsible Drilldown
