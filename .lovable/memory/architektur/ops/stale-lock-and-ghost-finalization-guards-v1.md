# Dauermaßnahmen: Stale-Lock Hard-Kill & Ghost-Finalization Guards

## Umgesetzt: 2026-04-09

### 1. STALE_LOCK Hard-Kill Guard (`trg_guard_stale_lock_loop`)
- **Trigger auf `job_queue`** (BEFORE UPDATE)
- Bei `attempts >= 3` + `STALE_LOCK_RECOVERY` im `last_error`: Admin-Warning (dedupliziert auf 2h)
- Bei `attempts >= 5`: Automatische Terminierung (`status = failed`, `STALE_LOCK_LOOP_HARD_KILL`)
  - Package wird mit `stuck_reason` geflaggt
  - Kritische Admin-Notification
  - Audit-Log in `auto_heal_log`
- Verhindert endlose pending↔processing Zyklen ohne manuelle Intervention

### 2. Ghost-Finalization-Guard (`fn_guard_ghost_finalization`)
- **Cron-Job alle 15 Minuten** (`ghost-finalization-guard`)
- Erkennt Steps in `running`/`enqueued` Status, die nie gestartet wurden (`started_at IS NULL`)
  aber zugehörige Jobs mit `attempts >= 3` haben
- Maßnahme: Step → `queued`, Ghost-Jobs → `failed` mit `GHOST_FINALIZATION_BLOCKED`
- Admin-Notification + Audit-Log

### Invarianten
- Stale-Lock-Guard feuert synchron im Trigger → kein Window für weitere Zyklen
- Ghost-Guard läuft asynchron alle 15min → fängt asynchrone Drifts
- Beide Guards schreiben in `auto_heal_log` für forensische Nachvollziehbarkeit
