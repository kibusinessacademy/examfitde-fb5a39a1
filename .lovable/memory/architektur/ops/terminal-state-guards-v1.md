# Terminal-State-Guards: Fachliche Nicht-Finalisierbarkeit

## Umgesetzt: 2026-04-10

### Problem
Das System erkannte operative Störungen (stale locks, zombies) gut, aber fachlich terminale Nicht-Finalisierbarkeit (z.B. HARD_FAIL_REPAIR_EXHAUSTED nach 61 Zyklen) wurde nicht früh genug als harter Stopp behandelt. Downstream-Jobs (QC, Publish) wurden weiter materialisiert/reclaimed.

### 5 Guards

#### Guard 1 — Downstream-Insert-Block (`trg_block_downstream_on_terminal_gate`)
- **Trigger** auf `job_queue` BEFORE INSERT
- Blockiert Enqueue von `package_quality_council`, `run_integrity_check`, `validate_exam_pool`, `package_publish`, `generate_exam_simulation_blueprint` wenn `gate_class = 'terminal'`
- Wirft `TERMINAL_GATE_BLOCK` Exception

#### Guard 2 — Reclaim-Block (`trg_block_reclaim_on_terminal_gate`)
- **Trigger** auf `job_queue` BEFORE UPDATE
- Bei `pending→processing` Transition: wenn Package terminal → Job wird silent auf `cancelled` gesetzt statt reclaimed

#### Guard 3 — Terminal-Eskalation-Cron (`fn_enforce_terminal_escalation`)
- **Cron alle 10 Minuten** (`enforce-terminal-escalation`)
- Erkennt Packages mit `validate_exam_pool` step auf `failed` + meta `gate_class` in HARD_FAIL_*
- Setzt `gate_class = 'terminal'`, `blocked_reason = 'manual_review_required'`
- Storniert alle offenen Downstream-Jobs
- Erzeugt kritische Admin-Notification mit Root-Cause-Code

#### Guard 4 — Integrity-Prerequisite (inline in Guard 1)
- QC-Jobs werden zusätzlich blockiert wenn `integrity_passed IS NOT TRUE`
- Verhindert den Kernfehler: QC materialisieren obwohl Integrity nicht bestanden

#### Guard 5 — Sofort-Anwendung
- Wirtschaftsinformatik (`c5000000-0004-4000-8000-000000000001`) retroaktiv auf `terminal` + `manual_review_required` gesetzt
- Alle offenen Jobs storniert

### Design-Prinzip
> "Wenn ein Package fachlich nicht mehr automatisch heilbar ist, stoppt die gesamte Downstream-Orchestrierung sofort."

### Komplementär zu
- Reconciler-Explosion Guard (fn_guard_reconciler_explosion)
- Stale-Lock-Rotation Guard (fn_guard_stale_lock_rotation)
- QGF-Bounce-Loop Prevention (fn_classify_gate_failure)
- Poison-Loop Guard (F-5)
