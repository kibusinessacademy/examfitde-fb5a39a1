# Governance-Step-Isolation v1

## Umgesetzt: 2026-04-13

### Problem
Governance-Steps (`run_integrity_check`, `quality_council`, `auto_publish`) wurden systemweit wie normale Pipeline-Steps behandelt — finalisierbar durch Zombie-Healer, True-Stall-Healer, Meta-Reconciler und direkte Enqueues. Dies führte zu:
- Phantom-Finalisierung (Step done ohne Job-Ausführung)
- DAG-Bypass (auto_publish ohne Integrity/Council)
- Cancel-Spam (Jobs sofort nach Claim storniert)
- Split-Brain (Step done, processing Job verwaist)

### Fixes (6 Dateien)

1. **stuck-scan-zombies.ts**: `run_integrity_check`, `quality_council`, `auto_publish` aus `ZOMBIFIABLE_STEPS` entfernt
2. **stuck-scan-hygiene.ts**: Gleiche Steps aus `TRUE_STALL_HEALABLE_STEPS` entfernt
3. **pipeline-process.ts**: Gleiche Steps aus inline `ZOMBIFIABLE_STEPS` entfernt
4. **package-quality-council/index.ts**: Direkter `enqueueJob("package_auto_publish")` entfernt — DAG-Healer übernimmt
5. **package-repair-failed-lessons/index.ts**: Raw `job_queue.insert("package_auto_publish")` entfernt — Package wird auf `building` gesetzt für DAG-Dispatch
6. **verifier-reconciler/index.ts**: `finalizeStep()` schließt jetzt auch `processing` Jobs mit ab (verhindert Split-Brain)

### Invariante
Governance-Steps dürfen **ausschließlich** von ihren eigenen Edge Functions finalisiert werden:
- `run_integrity_check` → nur durch `package-run-integrity-check`
- `quality_council` → nur durch `package-quality-council`
- `auto_publish` → nur durch `package-auto-publish`

Kein Healer, Zombie-Scanner, Reconciler oder Watchdog darf diese Steps auto-finalisieren oder direkt enqueuen.
