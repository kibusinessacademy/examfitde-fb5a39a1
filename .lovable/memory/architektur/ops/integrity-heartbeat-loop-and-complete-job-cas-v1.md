---
name: Integrity Heartbeat-Loop + complete_job CAS
description: package-run-integrity-check tickt jetzt verbindlich alle 30s (heartbeat_tick_count im meta), und complete_job (beide Overloads) committet nur noch via WHERE status='processing'. Schließt die Reaper-vs-Completion-Kollision (PRE_HEARTBEAT_KILL auf bereits completed Jobs).
type: feature
---

## Worker
- `INTEGRITY_HEARTBEAT_MS = 30_000` (vorher 25s, jetzt verbindlich 30s).
- Erster Tick `void tick()` läuft sofort vor `setInterval`. `meta.heartbeat_tick_count` wird je Tick inkrementiert.
- Fallback-Pfad (RPC-Signatur-Drift) schreibt jetzt **auch** `last_heartbeat_at` direkt und nutzt CAS `.eq("status","processing")`.

## DB-Contract
- `complete_job(uuid, jsonb)` und `complete_job(uuid, json, integer, numeric)` neu (Return-Type `boolean`).
  - `WHERE id=p_job_id AND status='processing'` — wenn 0 rows: Audit `auto_heal_log.action_type='complete_job_cas_conflict'` mit `metadata.observed_status` und Returnwert `false`.
- Reaper (`fn_reap_stale_processing_jobs`) klassifiziert weiter `last_heartbeat_at IS NULL` → PRE_HEARTBEAT_KILL[_TERMINAL], `IS NOT NULL` → STALE_AFTER_HEARTBEAT (CAS bereits seit S5).

## Telemetry
- View `v_complete_job_cas_conflicts` (24h, service_role-only) gruppiert nach (hour, job_type, observed_status).
- Smoke-RPC `fn_smoke_complete_job_cas(p_initial_status)` (service_role) inserted `pipeline_tick`-Row, ruft complete_job, prüft Outcome, räumt auf. DO-Block in der Migration verifiziert beide Truth-Cases (`processing→completed`, `pending→pending`).

## Tests
- `src/test/ops/s5b-integrity-heartbeat-loop.contract.test.ts` (9/9):
  - Statisch: 30s Konstante, setInterval-Loop, void-tick-First, tickCount++, Fallback-CAS, handler-Wire.
  - Fake-Timer Simulation: ≥2 Heartbeats in 65s.
  - DB-Contract: smoke RPC anon-refused, complete_job kein Syntax-Error.

## Lehre
Reaper-CAS allein reicht nicht: solange Worker-Completion ohne CAS schreibt, kann sie ein vom Reaper auf `pending` requeuetes Job-Row blind überschreiben. Status-Updates aus zwei Schreibern brauchen **immer** eine Vorbedingung im WHERE.
