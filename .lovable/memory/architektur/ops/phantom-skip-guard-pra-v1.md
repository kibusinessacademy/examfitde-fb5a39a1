---
name: Phantom-Skip Guard PR-A v1
description: Capability-aware Trigger blockt phantom/sweep skips auf Required-Steps und Oral-Steps auf Oral-eligible Paketen — Root-Cause-Stopper gegen L2-Sweep.
type: feature
---

## Kontext

2026-05-02 15:54:21 hat `data_holes_l2_phantom_skipped` einen Bulk-Sweep gefahren, der **3025 Steps** auf "skipped" gesetzt hat — darunter 193 × `build_ai_tutor_index`, 192 × `validate_tutor_index`, 170 × Oral-Steps. Folge: 167 Pakete ohne Tutor-Index, 99 ohne Oral-Trainer trotz ≥50 approved questions.

## Schutzregel

**Trigger** `trg_guard_no_required_step_phantom_skip` (BEFORE UPDATE OF status auf `package_steps`):

1. **Globally Required Steps** — kein Skip ohne legitimen Grund:
   - `auto_seed_exam_blueprints`, `validate_blueprints`, `generate_blueprint_variants`, `validate_blueprint_variants`, `promote_blueprint_variants`
   - `generate_exam_pool`, `validate_exam_pool`
   - `build_ai_tutor_index`, `validate_tutor_index`
   - `run_integrity_check`, `quality_council`, `auto_publish`

2. **Oral-Steps capability-aware** — `generate_oral_exam`, `validate_oral_exam` nur skippbar auf nicht-oral-fähigen Paketen oder mit legitimem Grund. Capability via `fn_package_has_oral_exam(uuid)` (Track + `certifications.oral_exam_enabled` für EXAM_FIRST_PLUS).

3. **Optional Steps** — müssen explizites `meta->>'skip_reason'` setzen (NULL/`phantom*`/`data_holes*`/`sweep*` blockiert).

## Legitimate Skip-Reasons (Allowlist)

`fn_skip_reason_legitimate(text)`:
- `track_not_applicable`, `track_ssot_not_applicable`, `auto_skipped_not_applicable`
- `oral_exam_qc_unhealable_below_threshold`
- `governance_bypass`, `admin_manual`, `admin_bypass`
- `capability_optional`, `cert_oral_disabled`

## Bypass

- Session-GUC `SET LOCAL app.allow_required_skip='on'` (admin-Skripte)
- `session_replication_role = 'replica'` (Migrations)

## Audit

- `auto_heal_log.action_type = 'phantom_skip_blocked_required_step'` mit `metadata.rule` (`globally_required_step_phantom_skip_blocked` | `oral_step_blocked_on_oral_eligible_package`)
- `auto_heal_log.action_type = 'phantom_skip_blocked_optional_step'` mit `metadata.rule = 'optional_step_requires_explicit_reason'`

## Helpers

- `fn_normalize_track(text) → text`
- `fn_package_has_oral_exam(uuid) → boolean`
- `fn_step_globally_required(text) → boolean`
- `fn_skip_reason_legitimate(text) → boolean`

Alle SECURITY-locked: REVOKE FROM PUBLIC,anon,authenticated; GRANT TO service_role.

## Smoke

In-Migration `DO $smoke$` versucht `build_ai_tutor_index → skipped` auf einem queued/blocked-Paket — muss `check_violation` werfen.

## Was kommt als Nächstes (PR-B)

- `v_phantom_skipped_required_drift` listet die 167+99 betroffenen Pakete inkl. Capability-Eligibility.
- `admin_heal_phantom_skipped_required_steps(p_step_key, p_dry_run, p_limit)` setzt `skipped→queued` mit Bypass-GUC + `admin_nudge_atomic_trigger`. Audit `phantom_skipped_required_heal`.

## Rollback

```sql
DROP TRIGGER trg_guard_no_required_step_phantom_skip ON public.package_steps;
DROP FUNCTION public.fn_guard_no_required_step_phantom_skip();
DROP FUNCTION public.fn_skip_reason_legitimate(text);
DROP FUNCTION public.fn_step_globally_required(text);
DROP FUNCTION public.fn_package_has_oral_exam(uuid);
DROP FUNCTION public.fn_normalize_track(text);
```
