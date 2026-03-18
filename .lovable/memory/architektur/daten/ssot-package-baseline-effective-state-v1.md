# SSOT Package Baseline & Effective State Architecture (v1)

## Problem (2026-03-18)
Multiple system components (Integrity Check, Auto-Gap-Closer, UI, Package Status) used different data sources and aggregation logic, causing:
- Auto-Gap-Closer reporting `competency_coverage=0%` when actual coverage was 49/49 (100%)
- UI showing "Quality Gate nicht bestanden" despite `integrity_passed=true`
- Stale `quality_gate_failed` status persisting after successful integrity pass
- Competing question counts: 3234 vs 4964 approved across different views

## Solution: 4-Layer SSOT Fix

### Layer 1: `ops_package_baseline_v1` (DB View)
Canonical source for all package metrics. Resolves competency coverage via `learning_fields` join (not direct `curriculum_id`), counts approved questions via `qc_status IN ('approved', 'tier1_passed')`.

### Layer 2: `ops_package_effective_state_v1` (DB View)
Derives effective gate state from baseline:
- `effective_quality_gate_state`: 'passed' | 'failed' | 'pending'
- `should_show_pass_banner` / `should_show_fail_banner`: boolean
- `autofix_allowed`: false if already passed or coverage < 40%

### Layer 3: Auto-Gap-Closer (`auto-gap-close/index.ts`)
Now reads `ops_package_baseline_v1` for competency coverage instead of broken RPC. Adds `ALREADY_PASSED` early exit when `integrity_passed=true`.

### Layer 4: Integrity Check Status Reconciliation
After successful integrity pass, `package-run-integrity-check` now reconciles stale statuses (`quality_gate_failed`, `blocked`, `stuck`) back to `building` to allow pipeline continuation.

### Layer 5: Frontend (`usePackageEffectiveState` hook)
UI components read `ops_package_effective_state_v1` for banner rendering instead of raw `package.status`. Components: `QualityGateBannerSSoT`, `AutoGapCloserSSoT`.

## Rule
All UI and Autofix counters MUST come from `ops_package_baseline_v1` or `ops_package_effective_state_v1`. Direct table queries for metrics are prohibited.
