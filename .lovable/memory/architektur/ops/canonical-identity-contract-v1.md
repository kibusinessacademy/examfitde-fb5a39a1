---
name: Canonical Identity Contract v1
description: Identity-Pflicht für Packages/Jobs/Steps/Logs. package_key (immutable) + job_name + correlation_id/root_job_id. ops_job_type_registry erweitert. 5 warn-only Guards.
type: feature
---

# Canonical Identity Contract v1 (2026-05-01)

## Kernregel
Jede Entität hat drei Identitäten: **UUID** (Maschine), **Key** (Systemlogik, immutable), **Name** (Mensch).

## Schema-Erweiterungen

### `ops_job_type_registry` (SSOT für Jobs)
Erweitert (keine neue Tabelle, vermeidet Drift mit `KNOWN_JOB_TYPES` + `_shared/job-map.ts`):
- `job_name` text — Pflicht-Lesbarkeit
- `lane` text (alias zu `pool`)
- `step_key` text
- `is_governance` boolean (council/integrity/auto_publish)
- `requires_package_id` boolean
- `is_active` boolean
- `updated_at` timestamptz + `tg_ops_job_type_registry_touch` Trigger

Backfill 2026-05-01: 158/158 mit job_name; 42 als `requires_package_id`; 10 als `is_governance`.

### `course_packages.package_key`
- Nullable, unique partial index, immutable nach Vergabe (Trigger `trg_guard_package_key_immutable`).
- Format: `<cert_slug_normalisiert>__<track>[__<subtype>][__v<n>][__<idshort>]`
- Hybrid-Backfill: 100% Pakete haben `certification_id` → cert_slug + track + Kollisions-Suffix.
- Begleit-Spalte: `package_key_assigned_at`.
- Helper: `fn_normalize_identity_key(text)` — IMMUTABLE, lowercase + Umlaute + non-alphanum→`_`.
- Baseline 2026-05-01: 439/439 aktive Pakete mit eindeutigem `package_key`, 0 Duplikate.

### `job_queue` Identity-Felder
- `job_name`, `correlation_id`, `root_job_id` (nullable, indexiert).
- `parent_job_id` existiert bereits → unverändert.
- Backfill: Recursive CTE über `parent_job_id`-Kette → `correlation_id` / `root_job_id`. Roots = self. Fallback: COALESCE(self).
- Baseline: 35068/35068 Jobs vollständig.

## Guards (Phase 3, warn-only)

`scripts/guards/canonical-identity-contract-guard.mjs` — 5 Sub-Guards:
1. **job_type_registry_guard** — kein Queue-job_type ohne Registry.
2. **package_identity_guard** — kein aktives Paket ohne package_key + title.
3. **job_package_id_guard** — kein Job ohne package_id, wenn requires_package_id=true (7d-Fenster).
4. **correlation_id_guard** — keine Jobs (24h) ohne correlation_id/root_job_id.
5. **log_identity_guard** — auto_heal_log: action_type + target_type + result_status Pflicht.

CI: `.github/workflows/canonical-identity-guard.yml` (PR + daily 06:30 UTC).
Mode: `warn` (default) → exit 0. `MODE=hard` → exit 1.

Baseline-Findings 2026-05-01:
- 0 missing in Guards 1-4
- 2771/40514 auto_heal_log-Einträge ohne result_status (Legacy-Drift, daher warn-only sinnvoll)

## Hard-Block-Plan
Nach 7 Tagen ohne neue Findings: Workflow auf `MODE=hard` umstellen + Producer-Helper `enqueueWithIdentity({package_id, job_type, correlation_id, root_job_id, parent_job_id})` einführen + DB-Trigger `trg_job_queue_identity_required` (BEFORE INSERT) für hard-block.

## Verboten
- `title` als Join-Key
- `slug` als SSOT
- UUID-only Logs
- Unregistrierte `job_type`-Werte
- `package_key` ändern (DB-Trigger blockt)

## Migrationen
- `supabase/migrations/20260501095557_*.sql` — Phase 1
- `supabase/migrations/20260501095708_*.sql` — Phase 2

## SYSTEM_RULES
Regel 21 (Identity & Naming) + Goldene Regel 22 ergänzt in `docs/SYSTEM_RULES.md`.
