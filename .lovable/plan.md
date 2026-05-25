# Berufs-KI Activation & Convergence Sprint

## Leitprinzip
Kein Tiefenausbau. Aktivierung der vorhandenen 8 Phasen. **Revenue first, Convergence second, Polish never.**
SSOT_FIRST · EXTEND_EXISTING · NO_PARALLEL_SYSTEMS · BRIDGE_DONT_FORK · FAIL_VISIBLE.

## Sprint-Struktur (7 Cuts, sequenziell)

```text
BK-Act-1  Monetization Spine        (Phase A1+A2)   ← Start
BK-Act-2  Revenue UX + Workbench    (Phase A3 + H)
BK-Act-3  ExamFit Convergence       (Phase B1–B4)
BK-Act-4  Profession Intelligence   (Phase C1–C3)
BK-Act-5  Document Agent Activation (Phase D1–D4)
BK-Act-6  Graph Materialization     (Phase E1–E3)
BK-Act-7  Legacy Kill + Analytics   (Phase F + G)
```

Jeder Cut endet mit: Migration + Smoke + Audit-Contract + Memory-Update.

---

## Cut BK-Act-1 — Monetization Spine (dieser Sprint)

### Ziel
Aus 6 generischen Free-Workflows entsteht eine **echte Tier-Matrix** mit hartem Gate. Keine Fake-Tiers, keine UI-only Locks.

### Scope
1. **Tier-Erweiterung Seed-Workflows** (Migration)
   - Bestehende 6 Workflows: `tier='free'` bleiben als Light-Variante (limitiert: 3 Runs/Tag, kein Export, kein Profession-Context).
   - **6 neue Pro-Workflows** mit echten `curriculum_id` + `competency_ids` Bindings:
     - `bilanzanalyse-erklaeren` (Bilanzbuchhalter)
     - `fachgespraech-simulieren` (Industriekaufmann)
     - `kundenreklamation-beantworten` (Industriekaufmann)
     - `pruefungsgespraech-vorbereiten` (FISI)
     - `geschaeftsvorfall-erklaeren` (Steuerfachangestellte)
     - `buchungssatz-validieren` (Bilanzbuchhalter)
   - **3 Business-Workflows**:
     - `ausbildungsfeedback-generieren`
     - `kompetenzluecken-aggregieren`
     - `team-readiness-report`

2. **Tier-Gate Hardening** (Edge + DB)
   - SSOT `fn_workflow_tier_check(user_id, workflow_id)` → `{allowed, reason, upgrade_target}`.
   - BEFORE-INSERT-Trigger auf `workflow_runs`: blockt bei `tier_violation` mit Audit-Mirror in `auto_heal_log` (action_type=`workflow_tier_blocked`).
   - Edge-Function `berufs-ki-workflow-run` ruft Gate **vor** AI-Call, schreibt `tier_check_result` in `metadata`.

3. **Daily-Limits & Export-Limits**
   - View `v_workflow_daily_usage` (per user × workflow × day).
   - Free: 3 Runs/Tag/Workflow. Pro: 50. Business: unlimited.
   - Export-Flag `export_allowed` in `workflow_runs` (Free=false, Pro/Business=true).

4. **Audit-Contract**
   - Register: `workflow_tier_blocked`, `workflow_run_granted`, `workflow_seed_pro_v1`, `workflow_seed_business_v1`.
   - Pflicht-Keys: `workflow_id`, `tier_required`, `tier_actual`, `user_id`.

5. **Smoke-Test**
   - `scripts/berufs-ki-tier-gate-smoke.mjs`: Free-User → Pro-Workflow → blocked. Pro-User → Pro-Workflow → granted. Free-User × 4 Runs → 4. Run blocked (limit).

### Out-of-Scope für Cut 1
- Revenue UX (Lock-Badges, Upgrade-CTAs) → Cut 2
- Knowledge-Graph Edges → Cut 6
- /berufski/* Legacy-Removal → Cut 7

### Technische Details
- Migration: 1 Datei, getrennt nach (a) Seeds, (b) Gate-Function, (c) Trigger, (d) View, (e) Audit-Contracts.
- Edge: `supabase/functions/berufs-ki-workflow-run/index.ts` erweitert, **kein neuer Endpoint**.
- Identity-Contract: jeder neue Workflow erhält stabilen `workflow_key` (immutable Trigger).
- Architectural Continuity Check: vorab `/admin/governance/architecture` lesen → **EXTEND_EXISTING** (workflows-Tabelle), **NO_PARALLEL_SYSTEMS** (kein neuer Runner).

### Definition of Done
- 15 Workflows in DB (6 Free + 6 Pro + 3 Business), alle mit `curriculum_id` NOT NULL für Pro/Business.
- Gate-Trigger aktiv, 3 Smoke-Cases grün.
- 4 Audit-Contracts registriert.
- Memory: `architektur/marketing/bk-monetization-spine-v1.md` + Index-Update.

---

## Bestätigung benötigt

Vor Start zwei Entscheidungen:

1. **Curriculum-Bindings für Pro-Workflows**: Soll ich die 6 Berufe (Bilanzbuchhalter, Industriekaufmann, FISI, Steuerfachangestellte) per `package_key`-Lookup automatisch an die published Curricula binden, oder gibt es eine kuratierte Mapping-Tabelle die ich verwenden soll?

2. **Tier-Source-of-Truth**: Nutze ich `entitlements.has_workflows_pro` / `has_workflows_business` als Gate-SSOT, oder soll ich auf `profession_licenses` (Phase 3-Tabelle) gaten? Empfehlung: **entitlements** (bereits B2C+B2B-fähig, license-template-aware aus S1).

Bei "go" starte ich Cut BK-Act-1 direkt mit der Migration.