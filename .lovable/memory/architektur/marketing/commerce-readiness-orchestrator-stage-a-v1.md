---
name: Commerce Readiness Orchestrator Stage A v1
description: Detect-Layer (read-only) für autonomes Commerce-Heal-System. View v_commerce_gap_classification + 2 RPCs + 6 Audit-Contracts + Code-SSOT der Repair-Matrix + Cockpit-Card. Stage B–D gated.
type: feature
---

# Commerce Readiness Orchestrator — Stage A

**Status:** Stage A live (read-only detect). Stage B (dry-run dispatch), C (bounded enqueue), D (full loop + auto-promote) durch Architectural-Continuity-Review gegated.

**Ziel:** Autonomes Detect → Classify → Repair → Verify → Republish → Re-Smoke der Commerce-/Delivery-Schicht. Erweitert bestehende Heal-/SSOT-/DAG-Architektur — kein Parallelsystem.

## SSOT

- **View `v_commerce_gap_classification`** — eine Zeile pro nicht-archiviertem `course_packages.id`. Liefert pro Paket bis zu 10 `gap_codes`:
  `MISSING_CANONICAL`, `MISSING_PRICE`, `MISSING_DELIVERY`, `MISSING_LESSONS`,
  `MISSING_EXAM_POOL`, `MISSING_TUTOR`, `MISSING_ENTITLEMENT`, `CHECKOUT_FAIL`,
  `TRACKING_FAIL` (audit-only, Stage A noch nicht populiert), `SEO_NOT_READY`.
- **Severity 0–3:**
  - 3 = sellable + (`MISSING_PRICE` ∨ `CHECKOUT_FAIL`) → silent revenue loss
  - 2 = published + (Delivery/Lessons/ExamPool/Tutor/Entitlement) → revenue blocking
  - 1 = sonstige (Canonical/SEO)
  - 0 = clean
- **Quellen (read-only joins, kein Neubau):** `course_packages` × `products` × `v_package_customer_safe_v1` × `v_sellable_and_deliverable` × `certification_seo_pages` × `auto_heal_log#funnel_smoke_run_summary` (26h Lookback) × `fn_is_bronze_locked` × `fn_package_pricing_ready`.

## Zugriff

- View hard-locked: `REVOKE FROM PUBLIC,anon,authenticated`, `GRANT SELECT TO service_role`.
- Zwei `SECURITY DEFINER`-RPCs mit `has_role(auth.uid(),'admin')`-Gate:
  - `admin_get_commerce_gap_summary()` → KPI-jsonb (total, fully_operational, with_gaps, severity_n, gap_distribution, last_smoke_at).
  - `admin_get_commerce_gap_detail(p_severity_min, p_limit, p_offset, p_only_visible)` → Tabelle.

## Audit-Contracts (Stage A registriert — Producer in Stage B+)

In `ops_audit_contract` registriert:
- `commerce_gap_snapshot` — Pflicht: total, with_gaps, severity_max
- `commerce_heal_dispatch_attempt` — package_id, gap_codes, decision
- `commerce_heal_repair_done` — package_id, gap_code, job_id
- `commerce_heal_verify_smoked` — package_id, smoke_run_id, success
- `commerce_heal_state_transition` — package_id, from_state, to_state
- `commerce_auto_promote_enqueued` — package_id, reason

## Code-SSOT der Repair-Matrix

`src/lib/commerce/commerceHealMatrix.ts` — 10-Eintrag-Matrix gap_code → existing job_type, cooldownHours, mode (auto_enqueue|smoke_rerun|audit_only|manual_review), severityHint.
- Auto-Enqueue: `post_publish_content_repair_lessons` (Delivery/Lessons), `package_generate_exam_pool`, `package_repair_tutor_index`, `seo_intent_page_generate`.
- Manual Review: `MISSING_PRICE` (Pricing-Integrity-Hard-Gate v2), `TRACKING_FAIL` (Strict-Event-Guard, Datenintegrität).
- Audit-only: `MISSING_CANONICAL` (DB STORED, Drift-Audit), `MISSING_ENTITLEMENT` (manuelles Repair-RPC).
- Smoke-Rerun: `CHECKOUT_FAIL` → targeted `funnel-smoke-daily`.
- Vitest `commerceHealMatrix.test.ts` prüft Vollständigkeit + Self-Reference + Severity-3-Invariante.

## UI

- `CommerceReadinessCard` in `/admin/v2/heal-cockpit` (neben `PaidButNotDeliveredCard`).
- KPI-Strip + Gap-Distribution-Chips (mit Tooltip aus Heal-Matrix) + Top-10 stuck (sev≥2, visible).

## Architectural-Continuity Compliance

- **EXTEND_EXISTING:** keine neuen Tabellen, keine neuen job_types, kein neues Audit-Backend.
- **NO_PARALLEL_SYSTEMS:** Heal läuft (Stage B+) über `job_queue` + `ops_job_type_registry`.
- **GOVERNANCE_BEFORE_AUTOMATION:** Stage B (dry-run), C (bounded enqueue), D (full loop) jeweils nach 48h-Beobachtung + Review-Eintrag.
- **AUDITABLE_MUTATIONS:** alle Stage-B+-Aktionen via `fn_emit_audit` + ops_audit_contract.
- **NO_AUTONOMOUS_PRODUCTION_WRITES:** Stage A schreibt **nichts**.

## Out-of-Scope (bewusst, durch Constraints geblockt)

- Pricing-Generation (Pricing-Integrity-Hard-Gate v2).
- Tracking-Repair (manuelles Review).
- Bridge-17+ Intelligence-Schichten (Architecture-Freeze post Bridge 16).

## Stage-Promotion-Bedingungen

| Stage | Voraussetzung |
|-------|---------------|
| A → B | 48h Detect-Audit ohne Drift, 0 unerwartete gap_codes |
| B → C | 48h Dry-Run zeigt deterministische Decisions, Cooldown-Logik geprüft |
| C → D | ≥80% Heal-Action-Schließrate in 24h, 0 >3-Cycle-Loops, Verify-Cron stable |
