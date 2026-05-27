## BerufAgentOS — Premium Enterprise Vertical Outcome AgentOS

Existing foundation we extend (no rebuild):
- **Phase 6 AgentOS** (`berufs_ki_agents`, `berufs_ki_agent_runs`, `berufs_ki_agent_orchestrations`, `berufs_ki_agent_memory`) — 6 Seed-Agenten, HITL, Confidence-Gate, Graph-Bridge, `/admin/berufs-ki/agents` + `/admin/berufs-ki/control-center`.
- **Safe Actions Framework** (`runtime_safe_actions`, dispatcher RPC, Reason ≥8, Audit) — bestehender Approval-Pfad.
- **Berufs-KI Workflows** (`WorkflowDefinition`, Curriculum/Lernfeld/Kompetenz/Blueprint-Bridge) — Berufs-/Branchen-Kontext-Vertrag.
- **BerufOS-Modulregistry** — AgentOS-Slot in `BERUFOS_MODULES` (`/berufos/agent-os`).
- **Architectural Continuity Guard** + **Audit Write Contract** + **Test-Fixture Contract**.

Wir bauen NICHT neu: keine zweite agents-Tabelle, kein paralleles Approval-System, keine eigene Audit-Pipeline.

---

### Scope dieses Cuts (BerufAgentOS Cut 1 — Outcome Bundle + Vertical DNA + Mission Control)

**1. Vertical/Branchen-DNA SSOT (DB)**
- `vertical_dna` (industry_key UNIQUE, name, roles[], kpis jsonb, risks jsonb, pain_points jsonb, sops jsonb, automation_potential jsonb, regulatory_context jsonb, is_active).
- 10 Seed-Branchen: public_admin, hr, real_estate, healthcare, banking, crafts, education, funding, consulting, support.
- Bridge: `berufs_ki_agents.vertical_keys text[]` + `berufs_ki_agent_runs.vertical_key`.
- Pflicht-Audit Contract: `vertical_dna_seeded`.

**2. Outcome Bundle SSOT**
- `agent_outcome_bundles` (run_id FK auf `berufs_ki_agent_runs`, outcome_goal text NOT NULL, vertical_key, business_case jsonb, process_model jsonb, kpi_impact jsonb, workflow_graph jsonb, risk_register jsonb, sops jsonb, roadmap jsonb, rollout_plan jsonb, dashboard_spec jsonb, artifacts jsonb, test_matrix jsonb, rollback_plan jsonb, review_status enum proposed|in_review|approved|rejected|applied|rolled_back, confidence numeric, completeness_pct numeric GENERATED).
- `agent_outcome_artifacts` (bundle_id, kind enum sop|workflow|api_contract|ui_spec|dashboard|test|seo_brief|compliance_note|business_case|roadmap, title, payload jsonb, export_format, sha256).
- SSOT-Regel als DB-Trigger: kein Bundle ohne `outcome_goal` + `vertical_key`; kein Workflow-Eintrag ohne min. 1 KPI.

**3. Agent Team Erweiterung (Seed)**
Ergänze die bestehenden 6 Agenten um die 10 Premium-Rollen aus dem Brief — als zusätzliche Rows in `berufs_ki_agents` (kein Parallel-Schema):
- strategy, product, workflow, build, ux, seo_authority, growth, security, compliance, executive.
- Jeder mit `governance_rules.outcome_contract` (welche Bundle-Felder er MUSS produzieren), `vertical_keys`, `requires_human_approval=true`, `confidence_threshold=0.75`.

**4. Outcome Run-Pipeline (Edge)**
- Neue Edge-Function `berufs-agent-outcome-run` (nicht Ersatz von `berufs-ki-agent-run`, sondern Orchestrator-Wrapper).
- Input: `{ outcome_goal, vertical_key, agent_team[], context }`.
- Lädt Vertical DNA + Berufs-DNA aus Curricula → injiziert in System-Prompt jedes Agenten.
- Ruft `berufs-ki-agent-run` sequentiell pro Agent (Strategy → Product → Workflow → Build → UX → SEO → Growth → Security → Compliance → Executive).
- Aggregiert Outputs in `agent_outcome_bundles`. Erzeugt Review-Queue-Eintrag via bestehende `runtime_safe_actions` (`action_key='approve_outcome_bundle'`, Reason ≥8 Pflicht).
- Audit: `outcome_bundle_created`, `outcome_bundle_review_dispatched`.

**5. RPCs (SECURITY DEFINER, has_role-gated)**
- `admin_get_outcome_bundle(_bundle_id)` — vollständiges Bundle + Artifacts.
- `admin_list_outcome_bundles(_vertical, _status, _limit)`.
- `admin_decide_outcome_bundle(_bundle_id, _decision, _reason)` — approve|reject|apply|rollback (Reason ≥8).
- `admin_get_vertical_dna(_industry_key)`.
- `admin_outcome_control_center()` — KPIs für Mission-Control.

**6. UI — Outcome Control Center (Premium, kein Chatfenster)**
- `/admin/berufs-ki/outcome-control` — Mission-Control-Hero (KPI-Strip: Active Bundles, Review Queue Depth, Avg Confidence, KPI-Impact-Sum, Rolled-back-Rate), Agent-Team-Board (alle 16 Agenten mit Live-Status), Outcome-Timeline.
- `/admin/berufs-ki/outcome-bundles` — List + Filter (vertical, status, confidence).
- `/admin/berufs-ki/outcome-bundles/:id` — Bundle-Detail mit Tabs: Business Case · Process Model · KPI Impact · Workflow Graph · Risk Register · SOPs · Roadmap · Rollout · Dashboard Spec · Artifacts · Test Matrix · Rollback. Approve/Reject/Apply-Dialog mit Reason-Textarea (min 8).
- `/admin/berufs-ki/vertical-dna` — Branchen-Registry mit DNA-Karten.
- Erweiterung `/berufos/agent-os` Public-Landing um Outcome-Claims aus Brief.

**7. Architecture Continuity Proposal**
- Vor Migration: `docs/examples/architecture-proposals/berufagentos-outcome-bundle-approved.json` als signierter Proposal-Eintrag (EXTEND_EXISTING — wir spiegeln Bundle als Knoten in `berufs_ki_graph_nodes` via Trigger).

**8. Memory + Audit**
- `mem://architektur/conversationos/...` ist falscher Pfad — wir nutzen `mem://features/berufs-ki/cut1-outcome-bundle-vertical-dna-v1.md`.
- Index-Update mit zwei Memory-Einträgen (Outcome Bundle SSOT + Vertical DNA).

**9. Tests**
- `src/test/berufs-ki/outcome-bundle-contract.test.ts` — Schema-Coverage (alle 13 Pflicht-Felder).
- `src/test/berufs-ki/vertical-dna-seed.test.ts` — 10 Branchen, eindeutige Keys.
- Edge-Smoke: `supabase/functions/berufs-agent-outcome-run/_smoke.ts` (per Fixture-Factory).

### Explizit ausgeschlossen (folgt in späteren Cuts)
- Apply-Engine (PR-Bot, Code-Mutation) — Cut 2.
- SEO-Authority + Growth tatsächliches Output-Ranking — Cut 2.
- Multi-Agent-Parallel-Execution (aktuell sequentiell) — Cut 3 (nutzt vorbereitetes `berufs_ki_agent_orchestrations`).
- Marketplace, Customer-Facing-Outcome-Catalog — Marktaktivierungs-Cut.

### Reihenfolge der Tool-Calls
1. `supabase--migration` (vertical_dna + agent_outcome_bundles + agent_outcome_artifacts + Trigger + Seeds + 10 neue Agenten + RPCs + GRANTs + RLS + Audit-Contracts).
2. User-Approval abwarten.
3. Edge-Function `berufs-agent-outcome-run` schreiben + Deploy.
4. UI-Pages + Hooks parallel schreiben.
5. Tests + Memory-Update parallel.
6. Vercel-Deploy läuft automatisch via Merge-Gate.

Wenn OK, starte ich mit der Migration.