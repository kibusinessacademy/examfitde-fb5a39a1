---
name: Control-Lane DAG-Drift Watchdog v1.4
description: 10-min cron healt Control-Lane-Stillstand. v1.2 fixt Sub-RPC-Signaturen (TABLE-Return + Pflichtargs), v1.3 setzt service_role JWT-Claim, v1.4 chunked Pending-Enqueue (5er-Batches) damit Trigger-Recursion-Konflikte einzelne Pakete nicht den Gesamtlauf killen. Vollständiger sub_reports-JSON in metadata.
type: feature
---

**Symptom:** control-Lane processing=0, completed_6h=0, pending wächst (74× package_auto_publish).

**Root-Cause:** `claim_pending_jobs_by_types` filtert über DAG-Prereqs. Quality-Council/Pending-Enqueue blockiert → control nie claimed.

**Fix-Historie:**
- **v1 (2026-05-02):** Watchdog `fn_heal_control_lane_dag_drift` + Cron `*/10 * * * *`.
- **v1.1:** target_id::text, Skip nur bei processing+updated_at<10min (sonst stale-Job blockiert ewig), Cron-Reschedule idempotent.
- **v1.2:** Sub-RPC-Signaturen korrigiert:
  - `admin_heal_failed_quality_councils()` returnt `TABLE`, nicht jsonb → `SELECT COUNT(*) FROM ...()`.
  - `admin_heal_pending_enqueue_drift(uuid[],text,boolean)` hat **Pflichtargs** → mit `array_agg(package_id) WHERE status='pending_enqueue'` aufgerufen.
- **v1.3:** Pending-Enqueue-RPC hat Auth-Gate (`admin OR service_role`). Watchdog läuft als Cron ohne Auth-Context → `set_config('request.jwt.claim.role','service_role',true)` lokal vor Aufruf.
- **v1.4:** Pending-Enqueue chunked (5 Pakete/Batch). Trigger-Recursion-Fehler `tuple already modified` betrifft jetzt nur einzelne Chunks, Rest läuft durch. Vollständiger Per-Chunk-Report in `metadata.sub_reports.pending_enqueue_drift.chunks`.

**Validierung v1.4:** Initial-Run 34/44 Pending-Enqueue-Pakete OK + 4 Failed-QCs healed. 10 verbleibende Failures = Logik-Bug in `admin_heal_pending_enqueue_drift` (Heiler triggert eigenen Trigger), separat adressieren.

**Sub-Report-Schema in `auto_heal_log.metadata`:**
```json
{
  "run_id": "...",
  "pkgs_nudged": 50,
  "queued_qc_nudged": 50,
  "stale_processing_seen": 0,
  "sub_reports": {
    "failed_quality_councils": { "healed": 4, "error": null },
    "pending_enqueue_drift": {
      "input_pkgs": 44, "pkgs_processed_ok": 34, "pkgs_failed": 10,
      "chunks": [{ "chunk_size": 5, "ok": true|false, "error": "...", "pkg_ids": [...] }]
    }
  }
}
```

**result_status:** `success` wenn keine Sub-Errors, sonst `partial`.

**TODO (separat):** `admin_heal_pending_enqueue_drift` selbst entkoppeln — Update auf `course_packages.status='building'` triggert orchestrate-after-step-Trigger, der wiederum dieselben package_steps anfasst, die der Heiler gerade resettet. Lösung: entweder Trigger-Recursion-Guard mit `pg_trigger_depth()` im Heiler oder zwei-phasen-Schreibweise (status erst, steps nach Commit).
