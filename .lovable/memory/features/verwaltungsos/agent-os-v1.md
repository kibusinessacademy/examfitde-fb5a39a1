---
name: VerwaltungsAgentOS v1 — Strict-RAG Workflow Runtime
description: Operative Verwaltungsprozess-Intelligenz auf realen Fachverfahren. Edge verwaltung-agent (Strict-RAG + [SOURCES] + Refusal), Audit-Pflicht, /admin/verwaltung/agents Operations Console, 40/40 Fachbereiche backfilled, 128 aktive Workflows, alle DNA-Depts ≥3 WF.
type: feature
---

# VerwaltungsAgentOS v1 — FROZEN 2026-05-28

## Architektur

**SSOT**: `verwaltung_agent_workflows` (department_key, workflow_key UNIQUE).
Kategorien: `process | communication | governance | fachverfahren | document | executive`.
Inhalte: `process_steps`, `kpi_targets`, `doc_outputs`, `escalation_triggers`, `automation_hints`, `governance_notes` (Rechtsgrundlage als String).

**Coverage 2026-05-28**: 40/40 DNA-Fachbereiche · 128 aktive Workflows · jede Verwaltung hat ≥3 Workflows.

## Runtime

**Edge** `verwaltung-agent` (Lovable AI Gateway, `google/gemini-2.5-flash`, temperature 0.2):
- Pflicht: `Authorization: Bearer <user-jwt>` (`getUser()`). Anon → 401.
- Lädt DNA + aktive Workflows per service_role.
- System-Prompt: AUSSCHLIESSLICH SOURCES, kein Spekulation, kein Rechtsrat, Pflicht-Trailer `[SOURCES] key1,key2`.
- Hard-Gate: zitiert die Antwort kein einziges `workflow_key` aus dem Kontext → deterministische Refusal.
- Audit: jeder Run → `fn_emit_audit(action_type='verwaltung_agent_run', payload={department_key, workflow_keys, question_hash, sources_count, llm_error, user_id})`.

## Audit-Contract

`ops_audit_contract.verwaltung_agent_run` mit Pflichtkeys `department_key, workflow_keys, question_hash, sources_count` — frozen via Migration 2026-05-28.

## UI

`/admin/verwaltung/agents` (`VerwaltungAgentsPage`): 3-Spalten Operations Console — Fachbereichsliste · Workflow-Karten (Kategorie, Steps, KPIs, Eskalationen, SSOT-Notes) · Strict-RAG-Query mit Source-Badges & Refusal-Visibility. **Kein Chat-Look**.

## Smoke

`scripts/verwaltung-agent-smoke.mjs` (8 Checks, GREEN 2026-05-28):
- `list_verwaltung_agents` (anon, 40)
- `get_verwaltung_agent(bauamt)` Shape
- `_smoke_verwaltung_agent_shape` anon blocked (401)
- shape per REP (7 Depts, wf≥3, DNA present)
- `verwaltung-agent` anon → 401
- `verwaltung-agent` bad-body → 400/401
- Coverage-Audit: 0/40 missing

## Anti-Drift (hard)

1. KEIN generischer KI-Agent. Outputs MÜSSEN aus `verwaltung_agent_workflows` zitieren.
2. Refusal-Phrase ist verbindlich — niemals ersetzen.
3. UI darf nicht wie ChatGPT/Copilot wirken — Operations-Center-Sprache, Source-Badges, Kategorie-Coding.
4. Neue Workflows nur per Migration/Insert + `is_active=true` + ON CONFLICT-Idempotenz.
5. Audit-Schema ist eingefroren — Erweiterungen brauchen `ops_audit_contract`-Update.

## Folgewirkung

- Cockpit-Card "AgentOS" verlinkt auf Operations Console (CTA in `VerwaltungCockpitPage`).
- Reality-Bridge kann KPI-Drift → Workflow-Engpass mappen (nächster Cut).
- Vorlage für `PraxisAgentOS`, `SteuerAgentOS`, `HandwerkAgentOS`, … (BranchenAgentOS-Architektur).
