---
name: BerufAgentOS v2 Cut 2.5 Persona Simulation Layer
description: Decision Intelligence vor Human Approval — Fix-Proposals werden gegen 5 reale Personas simuliert. HITL-only, kein Auto-Apply.
type: feature
---

# Cut 2.5 — Persona Simulation Layer (FROZEN 2026-05-27)

**Status:** ❄️ FROZEN — strikt HITL, keine Auto-Apply/Mutation/Self-Heal. Nächster Cut: 2.6 (Mission Control / Apply-Ledger erst nach 2.6).

**Verifikation 2026-05-27:**
- Smoke `scripts/berufagentos-cut2-5-smoke.mjs` — alle Checks grün
- DB-Objekte: `persona_registry` (5 Seeds), `outcome_fix_persona_simulations`, `v_outcome_fix_persona_matrix`, `fn_persona_composite_score`
- Audit-Contracts in `ops_audit_contract`: `persona_simulation_recorded` · `persona_simulation_cleared`
- Routing: `/admin/berufs-ki/persona-sim` aktiv, Cross-Link zur Fix-Queue
- HITL-Guard: keine `apply_persona_simulation` / `auto_apply_persona` / `mutate_workflow_from_persona` / `self_heal_persona` Symbole

## Scope
Detection → Proposal (2.4) → **Persona-Simulation (2.5)** → Review-Entscheidung (2.4 Fix-Queue).
Persona-Scores sind reine Entscheidungsgrundlage VOR Human Approval. Kein Apply, keine Mutation.

## Persona Registry (Enum + Table)
`persona_key`: `azubi`, `ausbilder`, `hr_leitung`, `berufsschule_ihk`, `admin_ops` — Seed in `persona_registry` mit display_name, Verantwortungs-Scope, default_risk_profile (low/medium/high) und sort_order.

## Simulation
- Tabelle `outcome_fix_persona_simulations` (UNIQUE proposal_id, persona_key)
- 4 Dimensionen: `utility_score`, `risk_score`, `comprehension_score`, `conversion_learning_score` (alle 0–1)
- `composite_score = 0.35·utility + 0.25·(1-risk) + 0.20·comprehension + 0.20·conversion_learning` (`fn_persona_composite_score`, IMMUTABLE)
- `rationale` text NOT NULL (≥16), `evidence` jsonb, `simulated_by` uuid, Zeitstempel

## Konfliktmatrix
View `v_outcome_fix_persona_matrix` (service_role only) — pro Proposal: best/worst Persona, avg_composite, utility_spread, **is_conflicted** (= jemand profitiert stark UND jemand trägt hohes Risiko).

## RPCs (SECURITY DEFINER + has_role admin)
- `admin_list_personas`
- `admin_simulate_proposal_persona` — Upsert, gesperrt sobald Proposal `approved/rejected/withdrawn/expired`
- `admin_clear_persona_simulation` (reason ≥8)
- `admin_get_persona_simulations` — Simulationen + Matrix-Row
- `admin_get_persona_conflict_matrix` — Filter Vertical, nur Konflikte

## Audit-Contracts
- `persona_simulation_recorded` — Pflichtschlüssel `proposal_id`, `persona_key`, `composite_score`
- `persona_simulation_cleared` — Pflichtschlüssel `proposal_id`, `persona_key`, `reason`

## UI
`/admin/berufs-ki/persona-sim` (`PersonaSimulationPage.tsx`):
- KPI-Strip (simulierte Proposals · Konfliktfälle · Ø Nutzen-Spread)
- Filter „Nur Konflikte"
- Liste offener Proposals (`draft/in_review/changes_requested`) mit Konflikt-Badge
- Detail-Panel: pro Persona Score-Bars, Composite, Rationale, Edit/Clear-Aktionen
- Dialog für Bewertung (4 Sliders + Begründung, harte 16-Zeichen-Validation)
- Cross-Link zur Fix-Queue (`/admin/berufs-ki/fix-queue`)
- Klarer Hinweis: „HITL — keine Auto-Anwendung."

## Harte Regeln (kein Auto-Mutate)
- ❌ Kein Auto-Apply  ❌ Keine Workflow-Mutationen  ❌ Kein Self-Heal  ❌ Keine Policy-Änderungen
- ✅ Persona-Bewertung, Konflikterkennung, Entscheidungs-Vorbereitung für menschliche Reviewer

## Bridges
- `proposal_id → outcome_fix_proposals` (Cut 2.4)
- Sperr-Logik: Simulation nur solange Proposal noch in offenem Review-State

## Verifikation
- Smoke: `scripts/berufagentos-cut2-5-smoke.mjs`
- Migration: `supabase/migrations/*persona*.sql`

## Nächster Schritt (NICHT in 2.5)
Cut 2.6: Mission Control / Cross-Proposal-Konfliktauflösung. Controlled-Autonomy (Apply-Ledger) ERST nach 2.6 mit explizitem Audit-Ledger und Rollback-Garantie.
