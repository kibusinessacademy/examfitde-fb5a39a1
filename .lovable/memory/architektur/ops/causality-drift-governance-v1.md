# Memory: architektur/ops/causality-drift-governance-v1
Updated: now

## Causality-Drift Governance v1

Schutz gegen "State/Artifact Divergence Bugs" — die Schwesterklasse zu Hollow-Completion.

### Drei Schutzschichten

**1. Artifact-to-Step Reconciler** (`fn_reconcile_seed_blueprints_causality`)
- Findet Pakete mit `question_blueprints.count > 0` aber `auto_seed_exam_blueprints != done`
- Setzt Step automatisch auf done via `admin_force_steps_done`
- Skip-Bedingungen: keine aktiven Seed-Jobs in `job_queue`, blueprints > 0
- Cron: alle 5min (`reconcile-seed-blueprints-causality`)
- Audit: jeder Run loggt nach `admin_actions` (action='reconciler_seed_blueprints_run')

**2. Anti-Hotloop Guard** (`fn_guard_generate_exam_pool_causality`)
- BEFORE INSERT/UPDATE Trigger auf `job_queue`
- Cancelled `package_generate_exam_pool` Jobs sofort, wenn `auto_seed_exam_blueprints` oder `validate_blueprints` nicht in (done, skipped)
- Setzt `last_error = 'UPSTREAM_CAUSALITY_NOT_SATISFIED: ...'`
- Audit: action='anti_hotloop_guard_blocked'

**3. Stale-Lock Counter Fix** (`fn_release_stale_job_locks` v2)
- Recovery-Counter wandert von `attempts` (wird bei Crash nicht inkrementiert) nach `meta.stale_lock_recoveries`
- Hard-Kill bei ≥5 Cycles → status='failed' + critical admin_notification
- Garantiert dass Hot-Loops endlich enden, auch wenn Runner repeatedly crashes vor attempt-increment

### Designprinzip

> Kein Step-State ohne Artefaktprüfung, und kein Artefaktzustand ohne Reconciler zurück in den Step-State.

### Schwesterregeln
- Hollow-Publish-Guard (`trg_guard_publish_requires_release_ok`): Artefakte fehlen → Block published
- Causality-Drift-Reconciler (this): Artefakte da → Sync Step done
