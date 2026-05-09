---
name: Gate Export History + Realtime v1
description: Gate-History Export-Job-Flow stabilisiert mit Realtime-CDC statt Polling, Export-Historie-Card mit per-Part-Download und Retry, admin_get_gate_export_jobs RPC. Auto-Open mehrerer Parts entfernt.
type: feature
---

**Stabilisierung S3 Export-Pipeline (2026-05-09):**

1. **RPC `admin_get_gate_export_jobs(p_limit int default 10)`** — SECURITY DEFINER, `has_role('admin')` Gate, REVOKE PUBLIC, GRANT authenticated+service_role. Liefert die letzten N Export-Jobs (id, package_id, window_days, lane, decision, format, status, total_rows, file_paths, error, timestamps).

2. **Realtime statt Polling** — `gate_export_jobs` ist in `supabase_realtime` Publication + `REPLICA IDENTITY FULL`. UI subscribed auf `postgres_changes` und invalidiert React-Query-Cache (`gate-export-job`, `gate-export-history`) bei jedem INSERT/UPDATE. Polling reduziert auf 15s Safety-Net (vorher 3s).

3. **Export-Historie-Card** im Pro-Paket-Tab: zeigt letzte 10 Jobs mit Status-Badge (success/info/danger/muted), total_rows, format, Lane/Decision-Tags, per-Part Download-Buttons (Signed-URL on demand, 1h TTL) und Retry-Button bei `failed` (re-enqueued mit denselben Filtern).

4. **Auto-Open entfernt** — `window.open` in der Loop für zusätzliche Parts wurde entfernt (Browser blockt Pop-ups, wirkt aggressiv). Stattdessen: User klickt pro Part in der Historie.

5. **Tests** in `src/test/admin/s3-ui-integration.test.tsx`: 
   - Job-Flow happy-path (Request → poll done → success toast)
   - Job-Flow failed (error toast + Retry-Button sichtbar)

**Constraint:** Keine direkten Frontend-Reads auf `gate_export_jobs` — alles über `admin_get_gate_export_job(s)` RPCs. Storage `gate-exports` bleibt privat, signed URLs nur on-demand bei `done`.
