---
name: CUT C0 — STEP_DONE_OUTPUT_MISSING Root Cause
description: Persistenz-Integritätsbruch generate_blueprint_variants — Reconciler/Stuck-Scan flippen Step→done ohne Output-Verifikation; Trigger rollt markStepDone zurück. Quelle für C2/C4.
type: feature
---

# Befund (read-only Snapshot, Baseline)

324 Pakete: `package_steps.step_key='generate_blueprint_variants'` mit `status='done'`,
aber **kein** `blueprint_variants`-Row über `question_blueprints.package_id`.

| Root-Cause-Code | n | Beschreibung |
|---|---:|---|
| `R1_RECONCILER_FALSE_DONE` | 255 | `verifier-reconciler` / `standalone_reconciler` setzt `done` auf Basis `meta.ok=true` ohne Output-Check. |
| `R2_STUCK_SCAN_ZOMBIE` | 29 | `stuck-scan` / `meta.note='zombie finalization'` — Finalisierung ohne Output-Check. |
| `R5_UNKNOWN_LEGACY` | 26 | Kein `finalized_by` in meta (Legacy-Pfad). |
| `R4_RUNNER_META_HEURISTIC` | 8 | `pipeline-runner` finalisiert via `step_meta` / `latest_completed_job` ohne Row-Verifikation. |
| `R3_ADMIN_HEAL_NO_VERIFY` | 6 | `admin_finalize_materialized_blueprint_variant_steps` (Admin-Heal ohne Verifikation). |

## Evidenz-Signale (aus `meta.previous_errors`)

- **`markStepDone verify MISMATCH … expected status=done, got=queued. Transaction may have been rolled back by a trigger.`** — der **eigentliche Bug**: ein Trigger rollt `markStepDone` zurück, der Schritt bleibt `queued`. Später setzt ein Reconciler ihn **trotzdem** auf `done`, obwohl der Worker nie persistiert hat.
- **`CAUSALITY_BLOCKED: dep validate_blueprints not done`** in 250+ Fällen — der Worker wurde nie legitim gestartet; Reconciler hat ihn dennoch finalisiert.
- `job_queue`: 9 248 completed, 3 093 cancelled, 0 pending für betroffene Pakete — Job-Layer hat den Run längst aufgegeben.

## Wahre Ursache (eine Zeile)

> **Mehrere Reconciler/Heal-Pfade akzeptieren `meta.ok=true` als hinreichend für `status=done` ohne Verifikation, dass tatsächlich Output-Rows persistiert wurden** — kombiniert mit einem Trigger, der `markStepDone` für diesen Step regelmäßig zurückrollt.

## Forensik-Artefakte

- View `public.v_step_done_output_missing` (klassifiziert, READ-ONLY).
- Tabelle `public.step_done_output_missing_snapshots` (Audit-Historie pro Run).
- RPC `public.capture_step_done_output_missing_snapshot()` (Admin/Service-Role; persistiert einen Run).
- Edge Function `pipeline-c0-step-done-output-missing` (READ-ONLY Trigger inkl. Trend).

## Konsequenzen für nachfolgende Cuts

- **C2 (Reparatur 303+105)** darf **erst** nach C4-Guard ausgeführt werden — sonst entstehen neue Silent-Drops.
- **C4 (Integritäts-Guard)** muss `generate_blueprint_variants.status='done' ⇔ ∃ blueprint_variants(package)` per Trigger erzwingen und alle Reconciler-Pfade verbieten, ohne Output-Check zu finalisieren.
- **R3-Pfad** (`admin_finalize_materialized_blueprint_variant_steps`) ist die einfachste Quick-Win-Sanierung: Output-Check in der RPC ergänzen.
- **R1/R2-Pfade** (verifier-reconciler, stuck-scan) sind die Hauptquelle — die Finalizer-Logik muss vom Meta-Signal auf Persistenz-Verifikation umgestellt werden.
