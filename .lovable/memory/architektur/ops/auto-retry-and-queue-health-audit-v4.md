---
name: Auto-Retry & Queue Health Audit v4 (Bulk-Throttle Split + Newer-Success Guard + Pagination)
description: Wave-4 Patch — admin_job_action in internal/public split (Bulk umgeht Per-Job-Throttle), force_pending mit newer-completed Guard, Timeline mit korrektem package_id-Filter via job_queue-Join, UI mit paginated Bulk Wellen, Guard-Preview Dialog & Search Box.
type: feature
---

## Wave-4 Änderungen vs. v3

### Backend
1. **Bulk-Throttle Split**: `admin_job_action_internal(_job_id, _action, _reason, _force, _uid)` ohne Throttle. `admin_job_action()` wrappt es mit 30/min-Cap. `admin_job_action_bulk()` ruft den internen Layer auf — somit kein doppeltes Throttling. Nur das Bulk-eigene 10/min-Limit greift. Vorher fielen ab Job 31 alle Bulk-Items durch das innere Single-Cap.
2. **force_pending → Newer-Completed Guard**: Wenn ohne `_force=true` ein neuerer `completed` Job für dieselbe `(job_type, package_id)` existiert → `guard_violation`. Schließt Lücke aus v3 (Auto-Retry hatte den Check, Admin-Action nicht).
3. **Timeline package_id Fix**: `admin_get_job_timeline()` joined `admin_actions.affected_ids` jetzt via `job_queue` zurück auf `package_id`. Vorher fehlten bei Paket-Filtern alle Admin-Actions.
4. **Decision-Trace job_type**: `job_retry_decisions.job_type` Spalte + Backfill. Auto-Retry schreibt's direkt, Timeline nutzt `COALESCE(d.job_type, q.job_type)`.

### UI
5. **Paginated Bulk Wellen**: UI chunkt selectedIds in Wellen à 50 (Server-Cap), sendet sequenziell mit Live-Progress (`done/total · ok/err`). Bricht bei Throttle-Error sauber ab.
6. **Guard-Preview Dialog**: Vor dem `force_pending`-Confirm zeigt das UI alle 5 Guards (has_package_id, pkg_status_ok, no_active_duplicate, not_admin_terminal, no_newer_completed) live mit ✓/✗. Scharfschalt-Button labelt sich um zu "Trotzdem ausführen (Unsafe)" wenn ein Guard fehlschlägt + Override aktiv ist.
7. **Audit-Log Search Box**: Volltext über `job_id`, `package_id`, `error_class`, `job_type`, `last_error`. Plus "Alle sichtbaren Failed wählen" für gezielte Bulks. Klick auf Root-Cause-Card prefilled die Suche mit der Error-Class.
8. **Timeline Search**: Drittes Feld filtert clientseitig auf `error_class`, `last_error`, `decision`, `job_type`.

## Aufrufer
- `admin_job_action(_job_id, _action, _reason, _force)` → public, throttled (30/min)
- `admin_job_action_internal(_job_id, _action, _reason, _force, _uid)` → SECURITY DEFINER, **NIE direkt aus dem Client aufrufen**, nur Bulk
- `admin_job_action_bulk(_job_ids[], _action, _reason, _force)` → max 50, 10/min, eigene Pagination clientseitig

## Guard-Set für force_pending (ohne _force)
1. Package-Bound Job hat `package_id`
2. Package-Status in `[building, queued, blocked, pending, draft]`
3. Kein aktiver Duplikat in `fn_job_active_statuses()`
4. `meta.admin_terminal != true`
5. **NEU**: Kein neuerer `completed` Job mit gleichem `(job_type, package_id)` und `updated_at > _row.updated_at`
