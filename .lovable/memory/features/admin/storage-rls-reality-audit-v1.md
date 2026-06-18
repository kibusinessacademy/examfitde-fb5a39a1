---
name: STORAGE.RLS.REALITY.AUDIT (Phase 1 + 2.0 frozen)
description: Storage Reality Attack Layer — Phase 1 (RLS audit + Phase 1.1 reporting/blocker) and Phase 2.0 (tenant-reality attacks A–D) frozen scope, gates, and exit criteria
type: feature
---

# STORAGE.RLS.REALITY.AUDIT

Status: **Phase 1 + Phase 2.0 FROZEN** (Scaffolding complete, awaiting first controlled smoke run).
Next operational loop after freeze: **BILLING.CLOSING.LOOP.1** (not further storage deepdive).

## Phase 1 (Reality Scanner + 1.1 Reporting/Blocker) — FROZEN
- Edge fn: `storage-attack-simulator` (single-tenant artifact-based audit under `__storage_audit__/`).
- Cleanup-Blocker: if `cleanup_count != objects_sampled`, next full run is hard-blocked via `fn_storage_attack_can_run()`.
- Reports: JSON + CSV downloadable per run from Attacks tab.
- Findings grouped by content_class with risk score.
- Detailed run logs (start/stop, allowed_buckets, planned/sampled object counts, cleanup status) surfaced in UI for kill-switch debugging.

## Phase 2.0 — Tenant-Reality Attacks (FROZEN, ARMED-OFF)
Edge fn: `storage-tenant-attack-simulator`. Two synth JWT identities (Tenant A + B).

Classes (all default `enabled=false`, `kill_switch=true`):
- **Attack A** `cross_tenant_object` — read foreign-tenant object via anon client
- **Attack B** `signed_url_replay` — replay signed URL across context (incl. header-spoof variant)
- **Attack C** `path_enumeration` — `list()` foreign tenant prefixes
- **Attack D** `idor_object_id` — guess deterministic `{tenant}/{resource}/{id}` paths

### Hard Allowlist (server-enforced)
Only: `seo_assets`, `media_uploads`, `system_assets`.
**Explicitly blocked** from Phase 2.0: `learner_data`, `certificate`, `assessment`, `exam_content`, `curriculum`, `ai_artifact`.

### Gates (non-negotiable)
1. `fn_storage_attack_class_enabled(_class_key)` — class must be enabled AND kill_switch off
2. `fn_storage_attack_can_run()` — global cleanup-blocker
3. Synth-only tenant IDs (no real `auth.users`)
4. Findings auditable in `storage_attack_run_results`

## Exit Criteria for Phase 2.0 (before declaring closure on real runs)
One controlled smoke run per attack class on allowlisted buckets only:
- Attack A → `findings = 0`, `critical = 0`
- Attack B → `findings = 0`, `critical = 0`
- Attack C → `findings = 0`, `critical = 0`
- Attack D → `findings = 0`, `critical = 0`

**Stop conditions (immediate halt + escalate):**
- Any `attack_type = signed_url_replay` finding (→ certificate/export/tutor-file leak risk)
- Any `attack_type = idor` finding (→ same risk class)

`enumeration` findings on `seo_assets`/`media_uploads` are downgraded to hygiene/architecture follow-up, not P0.

## Phase 2.1 — Deferred (Service-Role Drift)
**Do NOT** start with runtime Attack E. Governance-first sequence:

1. **STORAGE.SERVICE_ROLE.INVENTORY** (read-only static scan)
   - Enumerate all callsites of: `createSignedUrl`, `createSignedUrls`, `download`, `getPublicUrl`, `storage.from(...)`
   - Classify each: `wrapper_protected` | `wrapper_unknown` | `direct_service_role`
2. **`sign_storage_url` wrapper enforcement** (CI guard once inventory is clean)
3. **Attack E** (runtime service-role drift) only after wrapper coverage ≥ target threshold

Rationale: service-role drift is primarily a codepath/governance problem, not a storage runtime problem. Largest security gain comes from inventory + wrapper enforcement.

## Tables / Views (frozen surface)
- `storage_attack_classes` (registry, per-class toggles)
- `storage_attack_policies` (global policy)
- `storage_attack_run_results` (audit log, includes `synth_tenant_a`, `synth_tenant_b`, `attack_class`)
- `storage_audit_runs`, `storage_rls_audit_findings` (Phase 1)
- `v_admin_storage_attack_by_class` (UI matrix: attack_class × content_class)

## UI
`src/pages/admin/StorageRealityPage.tsx` — Attacks tab contains Phase 2.0 control card + findings matrix.
Kill-switch debugging info rendered inline (run logs, cleanup status).
