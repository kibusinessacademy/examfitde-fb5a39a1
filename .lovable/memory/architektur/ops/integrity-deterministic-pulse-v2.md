---
name: Integrity Deterministic Pulse v2
description: setInterval-Heartbeat im integrity-Worker durch deterministische await pulse(stage)-Aufrufe an 8 Stage-Boundaries ersetzt. meta.heartbeat_log + last_stage geben Forensik. Edge-Runtime suspendiert keine awaits — keine stuck-tick=1 Loops mehr.
type: feature
---

## Problem (v1, Loop-basiert)
`setInterval(tick, 30s)` wurde im Edge-Runtime während CPU-/IO-schwerer awaits suspendiert → `meta.heartbeat_tick_count` blieb bei 1 trotz 480s+ Laufzeit. Reaper-vs-Completion-CAS schützte das, aber Forensik (welche Stage hängt?) war blind.

## Lösung (v2, Pulse-basiert)
`startIntegrityHeartbeat` returns `{ pulse(stage), stop, tickCount }`. Kein `setInterval` mehr.
Handler ruft `await heartbeat.pulse('<stage>')` an 8 Stage-Boundaries:
1. `handler_start` (nach package_id-Validation)
2. `prereq_done`
3. `pre_course_ready_gate`
4. `post_course_ready_gate`
5. `progress_recorded`
6. `pre_persist`
7. `post_persist`
8. `handler_done`

Jeder Pulse:
- inkrementiert `tickCount`
- appended `{tick, stage, at_ms}` an `pulseLog` (cap 25, sliced -10 in meta)
- schreibt via `heartbeat_job_processing` RPC (CAS-fallback wie v1)
- meta enthält jetzt `last_stage` + `heartbeat_log` zur Forensik

## Vertrag / Pflicht für neue Stages
- **Maximaler Gap zwischen zwei Pulses ≤ INTEGRITY_HEARTBEAT_MS (30s)** — die Konstante bleibt als Dokumentations-Schwelle.
- Neue lange Sektionen MÜSSEN ein `await heartbeat.pulse('<name>')` davor und/oder danach setzen.
- Stage-Namen sind frei wählbar, müssen aber im Contract-Test (`s5b-integrity-heartbeat-loop.contract.test.ts`) gespiegelt werden, sonst rot.

## Telemetry
- `meta.heartbeat_tick_count` → Anzahl Stages, die der Worker erreicht hat (vor Crash/Kill)
- `meta.last_stage` → wo zuletzt gepulst (sofortige Forensik bei Stale-Kill)
- `meta.heartbeat_log[-10]` → kompletter Stage-Verlauf der letzten 10 Pulses

## Lehre für andere Long-Running-Worker
Edge-Runtime ist **nicht** garantiert wall-clock-time-driven für Timer. Wer >60s arbeitet darf sich nicht auf `setInterval` verlassen. Pattern: explizite `await pulse(stage)` an Stage-Grenzen. Deterministisch, runtime-unabhängig, sofort forensik-tauglich.

## Files
- `supabase/functions/package-run-integrity-check/index.ts`
- `src/test/ops/s5b-integrity-heartbeat-loop.contract.test.ts` (10/10 grün)
