---
name: Pending-Enqueue Observability Stack
description: Cron Health View, Manual Review Queue für Cascade-Konflikte, Stuck-Steps Dashboard — strikt getrennt vom Heal-Pfad für queued/blocked Pakete
type: feature
---

## Komponenten
- **View `v_pending_enqueue_cron_health`**: zeigt für `pending_enqueue_reschedule_minutely` und ähnliche Cron-Jobs Schedule, Last-Run, Lag (>3min @ minutely / >15min @ */5), Heal/Skip/Fail-Counts der letzten Stunde aus `pending_enqueue_reschedule_log`.
- **Tabelle `pending_enqueue_manual_review`** (admin-RLS): Steps, die wegen Cascade-Trigger-Konflikten wiederholt `reschedule_failed` geloggt haben. Status: open|investigating|resolved|wont_fix. Niemals automatisch geheilt.
- **Funktion `fn_flag_pending_enqueue_manual_review(min_failures, window_minutes)`**: SECURITY DEFINER, scannt Log nach >=2 Failures in 30min (Default) und legt Review-Eintrag an oder updated counter.
- **Cron `pending_enqueue_manual_review_flagger`** (`*/5 * * * *`): triggert Flagger-Funktion.
- **Admin-Route**: `/admin/ops/stuck-steps` mit drei Read-Cards (CronHealth, ManualReview, StuckSteps+Log).

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
