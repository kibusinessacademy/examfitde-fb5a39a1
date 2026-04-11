# Memory: architektur/ops/zero-progress-guard-v1
Updated: 2026-04-11

## Problem
Endlose Requeue-Zyklen: Jobs werden enqueued → laufen → complete mit 0 Output → Step bleibt `queued` → Orchestrator enqueued erneut. Dies führte zu 1.000+ Zombie-Jobs pro Paket (z.B. Fachinformatiker Systemintegration: 1.302 `generate_blueprint_variants` Jobs).

## Bisherige Schutzschichten
- `enqueue_job_if_absent`: Verhindert doppelte aktive Jobs, aber NICHT Re-Enqueue nach Completion
- `ops_reap_duplicate_jobs`: Bereinigt pending-Duplikate, greift aber erst nachträglich
- Hot-Loop-Detektion (`stuck-scan-hot-loop.ts`): Erkennt Zyklen erst ab 4+ in 60min, Freeze ab 10+

## Lösung: Zero-Progress-Guard (in `enqueue_job_if_absent`)
Neuer Guard 2 direkt in der zentralen Enqueue-Funktion:

1. Zählt completed Jobs desselben Typs pro Paket in den letzten 2h
2. Wenn ≥3 completed Jobs existieren UND der zugehörige Step nicht `done`/`skipped` ist → **Enqueue blockiert**
3. Rückgabe: `deduped=true, existing_status='zero_progress_blocked'`
4. Step-Key wird aus job_type abgeleitet (strip `package_` prefix)

## Zusammenspiel mit Hot-Loop-Guard
- Zero-Progress-Guard: **Präventiv** — blockiert BEVOR neue Jobs erstellt werden
- Hot-Loop-Guard: **Reaktiv** — erkennt und friert bestehende Zyklen ein
- Beide Guards sind komplementär und unabhängig

## Ausnahmen
- Jobs ohne `package_id` (generische Jobs) werden nicht geprüft
- Steps die `done` oder `skipped` sind, werden durchgelassen
- Pakete ohne zugehörigen Step in `package_steps` werden durchgelassen
