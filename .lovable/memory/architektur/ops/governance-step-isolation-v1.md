# Governance-Step-Isolation v1 → v2

## Umgesetzt: 2026-04-13

### Problem (v1)
Governance-Steps (`run_integrity_check`, `quality_council`, `auto_publish`) wurden systemweit wie normale Pipeline-Steps behandelt — finalisierbar durch Zombie-Healer, True-Stall-Healer, Meta-Reconciler und direkte Enqueues. Dies führte zu:
- Phantom-Finalisierung (Step done ohne Job-Ausführung)
- DAG-Bypass (auto_publish ohne Integrity/Council)
- Cancel-Spam (Jobs sofort nach Claim storniert)
- Split-Brain (Step done, processing Job verwaist)

### v2-Erweiterung: Tiefere Root Causes gefunden

#### RC1: fn_heal_queued_steps_without_jobs behandelte Governance-Steps
Die DAG-basierte Healer-Funktion enqueued Governance-Steps, sobald deren `pipeline_dag_edges`-Abhängigkeiten als `done` ODER `skipped` markiert waren. Bei Packages mit 15% Fortschritt waren alle Governance-Voraussetzungen (elite_harden, validate_handbook_depth etc.) `skipped` → Healer enqueued `run_integrity_check` trotzdem.

#### RC2: Content-Runner Stale-Lock-Recovery ohne Lane-Scoping
Content-Runner's Stale-Lock-Recovery (Zeile 973) scannte ALLE `worker_pool='default'` Processing-Jobs — unabhängig von der Lane. Dadurch:
- Control-Lane-Jobs (integrity_check) wurden vom Content-Runner recycled
- 16 Integrity-Check-Jobs blockierten ALLE Runner-Slots
- Generation-Jobs (das eigentliche Arbeitspensum) verhungerten

#### RC3: WIP-Cap nicht erzwungen
WIP-Cap war 13+5=18, aber 36 Packages waren `building`. Orphan-Reaper machte nur Telemetrie, kein Enforcement.

### Fixes (v1 + v2 kumuliert)

#### v1 Fixes
1. **stuck-scan-zombies.ts**: Governance-Steps aus `ZOMBIFIABLE_STEPS` entfernt
2. **stuck-scan-hygiene.ts**: Governance-Steps aus `TRUE_STALL_HEALABLE_STEPS` entfernt
3. **pipeline-process.ts**: Governance-Steps aus inline `ZOMBIFIABLE_STEPS` entfernt
4. **package-quality-council/index.ts**: Direkter `enqueueJob("package_auto_publish")` entfernt
5. **package-repair-failed-lessons/index.ts**: Raw `job_queue.insert("package_auto_publish")` entfernt
6. **verifier-reconciler/index.ts**: `finalizeStep()` schließt jetzt auch `processing` Jobs ab

#### v2 Fixes
7. **fn_heal_queued_steps_without_jobs (DB)**: Governance-Steps via `AND ps.step_key <> ALL(v_governance_steps)` ausgeschlossen
8. **content-runner/index.ts**: Stale-Lock-Recovery lane-scoped auf `GENERATION` Jobs via `jobTypesForLane("generation")` Filter
9. **Migration**: 16 blockierende Processing-Integrity-Jobs cancelled + WIP-Cap erzwungen (Excess → blocked)

### Invariante (verschärft)
Governance-Steps dürfen **ausschließlich** von ihren eigenen Edge Functions finalisiert UND enqueued werden:
- `run_integrity_check` → nur durch `package-run-integrity-check`
- `quality_council` → nur durch `package-quality-council`
- `auto_publish` → nur durch `package-auto-publish`

**Kein** Healer, Zombie-Scanner, Reconciler, Watchdog, Stale-Lock-Recovery oder generische Healer-Funktion darf diese Steps auto-finalisieren, enqueuen oder über Lane-Grenzen recyclen.

### WIP-Enforcement
WIP-Cap wird jetzt als **permanente DB-Invariante** erzwungen:
- Trigger `trg_enforce_wip_cap` auf `course_packages` blockiert jede Transition zu `building`, wenn der Cap erreicht ist
- Cap wird aus `ops_pipeline_config.wip_total_cap` gelesen (Fallback: 18)
- **Kein** Healer, Reconciler, Watchdog oder manueller Update kann den Cap überschreiten

### Content-Runner Lane-Isolation (v2 verschärft)
Beide Stale-Lock-/Stale-Cleanup-Pfade im Content-Runner sind jetzt lane-scoped:
1. Stale-Lock-Recovery (Zeile ~974): nur `generation` Lane Jobs
2. Pre-Claim Stale Cleanup (Zeile ~1048): nur `generation` Lane Jobs
Der Job-Runner hat **keine** Stale-Lock-Recovery — kein Lane-Leak dort.
