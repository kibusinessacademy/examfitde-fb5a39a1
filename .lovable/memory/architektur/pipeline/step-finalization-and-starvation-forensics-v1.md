# Memory: architektur/pipeline/step-finalization-and-starvation-forensics-v1
Updated: 2026-04-11

## Problem
Sub-Jobs (lesson_generate_content, lesson_generate_competency_bundle) schließen erfolgreich ab, aber der übergeordnete Pipeline-Step (package_steps) wechselt nicht auf 'done'. Dies führt zu Starvation: 242+ completed Jobs ohne echten Step-Fortschritt.

## Root Causes (forensisch isoliert)
1. **WIP-Zählfehler**: `learning-content-scheduler.ts` zählt nur `lesson_generate_content`, nicht `lesson_generate_competency_bundle` → falsches WIP/Completion-Bild
2. **Zero-Progress-Guard blockiert Dispatcher**: `enqueue_job_if_absent` blockiert Root-Dispatcher (`package_generate_learning_content`) nach 3 abgeschlossenen Runs, obwohl noch offene Child-Arbeit existiert
3. **Schwache Finalisierungssignale**: `batch_complete=true` konnte Step-Finalisierung triggern, ohne Artefakt-Verifizierung
4. **Fehlender Materialisierungs-Verifier**: Kein SSOT-Check ob Lessons tatsächlich Content haben

## Fixes (implementiert 2026-04-11)
1. **DB: `enqueue_job_if_absent` gehärtet** — Inkrementelle Dispatcher (6 Job-Typen) haben höheren Schwellenwert (8 statt 3) und höheres Fan-out-Cap (5 statt 3)
2. **Scheduler: Bundle-Jobs in alle Counts aufgenommen** — `countGlobalInFlight`, `countPackageInFlight`, `computeAdaptiveWip` zählen jetzt `lesson_generate_competency_bundle` mit
3. **Finalisierung gehärtet** — `generate_learning_content` akzeptiert kein `batch_complete` mehr; primäres Signal ist der neue Rootstep-Verifier
4. **Rootstep-Verifier** — `rootstep-verifier.ts` prüft echte Artefakt-Materialisierung (needs_regen=0 + keine aktiven Children) vor Finalisierung
5. **Reconciler** — Läuft VOR dem Finalization-Guard im Pipeline-Runner und schreibt `verifier_ready` in Step-Meta

## Invarianten
- Kein Content-Rootstep darf auf `batch_complete` allein finalisiert werden
- WIP-Counts MÜSSEN alle Content-Job-Typen einschließen
- Root-Dispatcher dürfen nicht mit dem gleichen Schwellenwert wie One-Shot-Jobs behandelt werden
- Verifier prüft: needs_regen=0 UND active_child_jobs=0 UND completion_ratio ≥ 0.95
