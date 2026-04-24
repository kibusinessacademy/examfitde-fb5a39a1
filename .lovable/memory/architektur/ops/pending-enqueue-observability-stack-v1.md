---
name: Pending-Enqueue Observability Stack
description: Cron Health View, Manual Review Queue für Cascade-Konflikte, Stuck-Steps Dashboard — strikt getrennt vom Heal-Pfad für queued/blocked Pakete
type: feature
---

## Komponenten
- **View `v_pending_enqueue_cron_health`**: Schedule, Last-Run, Lag, Heal/Skip/Fail-Counts (1h).
- **View `v_pending_enqueue_stuck_enriched`**: Stuck-Steps + `fix_prognosis` (eligible_now | awaiting_min_age | blocked_by_active_job | blocked_by_package_status | manual_review_required) + Manual-Review-Status.
- **View `v_pending_enqueue_audit_export`**: Reschedule-Log + zugehörige `cron_run_id`/`cron_job_id` über LATERAL-Join im 90s-Fenster.
- **Tabelle `pending_enqueue_manual_review`** (admin-RLS): Cascade-Trigger-Konflikte, niemals auto-geheilt.
- **RPC `fn_force_reschedule_step(pkg, step)`**: Admin-only, bypasst min_age, schließt offene Manual-Reviews als resolved.
- **RPC `fn_cancel_pending_enqueue_step(pkg, step, reason)`**: Admin-only, setzt Step → blocked, schließt Manual-Reviews als wont_fix.
- **RPC `fn_replay_recent_reschedules(window, max)`**: Admin-only, idempotenter Re-Run via min_age=0 + bestehende guards.
- **Admin-Route**: `/admin/ops/stuck-steps` mit Cards (CronHealth, ReplayAndExport, StuckStepsActionTable, ManualReviewQueue, StuckStepsTable+Log).

## Heal-Pfad-Trennung (CRITICAL)
| Status              | Heal-Pfad                                                  |
|---------------------|------------------------------------------------------------|
| `pending_enqueue`   | `fn_reschedule_pending_enqueue_steps` (cron, building only) |
| `queued` / `blocked`| **separater Pfad** — Admin Course Workspace „Entblockieren & Starten" |
| Cascade-Konflikt    | `pending_enqueue_manual_review` — nur manuelle Auflösung   |

Niemals einen kombinierten Heal-Endpoint über mehrere Status/Pfade — bewusste Architektur-Entscheidung.

## Bekannter Doppel-Cron (zu beobachten)
- `resolve-pending-enqueue-steps` (`*/5`) — Bestand
- `pending_enqueue_reschedule_minutely` (`* * * * *`) — neu
Beide aktiv, beide healen nur `building`-Pakete; durch existence-guard auf job_queue keine Race-Condition. Konsolidierung optional.
