# Admin View Contracts

Status: ACTIVE  
Owner: Core Platform  
Last Updated: 2026-03-21

## Purpose

This document defines the **required column contracts** for all `v_admin_*` database views.  
These contracts are enforced by `scripts/guard-admin-view-contracts.mjs` in CI.

Any migration that drops or renames a required column will fail the guard.

---

## v_admin_queue_ssot

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| job_id | string | ✅ | Primary identifier |
| job_type | string | ✅ | Job classification |
| job_status | string | ✅ | Current status |
| package_id | string | ✅ | Related package |
| package_title | string | ✅ | Display name |
| package_status | string | ✅ | Package state |
| priority | number | ✅ | Sort priority |
| attempts | number | ✅ | Retry count |
| max_attempts | number | ✅ | Retry limit |
| created_at | string | ✅ | Canonical timestamp |
| started_at | string | ✅ | Processing start |
| completed_at | string | ✅ | Completion time |
| last_error | string | ✅ | Error message |
| health_signal | string | ✅ | Derived health |
| age_minutes | number | ✅ | Derived age |
| meta | json | ✅ | Metadata blob |
| updated_at | string | ✅ | Last update |
| locked_at | string | ✅ | Lock timestamp |
| locked_by | string | ✅ | Lock owner |
| run_after | string | ✅ | Scheduled time |

---

## v_admin_packages_ssot

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| package_id | string | ✅ | Primary identifier |
| raw_title | string | ✅ | Original title |
| canonical_title | string | ✅ | Normalized title |
| status | string | ✅ | Package status |
| build_progress | number | ✅ | Build % |
| current_step | string | ✅ | Active pipeline step |
| priority | number | ✅ | Sort priority |
| council_approved | boolean | ✅ | Approval flag |
| integrity_passed | boolean | ✅ | Integrity gate |
| created_at | string | ✅ | Creation time |
| updated_at | string | ✅ | Last update |
| is_published | boolean | ✅ | Publish state |
| track | string | ✅ | Training track |

---

## Rules

1. **Never rename** a required column without updating both the view AND the contract
2. **Always include** `NOTIFY pgrst, 'reload schema'` after view recreation
3. **Health signal values** must be one of: `zombie`, `stale_lock`, `exhausted`, `retriable`, `aging`, `normal`
