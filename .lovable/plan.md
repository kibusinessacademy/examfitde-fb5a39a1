# BerufAgentOS v2 — Autonomous Vertical Quality & Outcome OS

Die Vision ist ein Paradigmenwechsel: vom **Agentensystem** zum **dauerhaft lernenden Unternehmens-Gehirn**. Das ist kein einzelner Build, sondern eine neue Plattform-Schicht, die nur sequenziell wachsen kann — sonst entsteht genau die Drift, die `mem://constraints/architecture-freeze-post-bridge-16-v1` verbietet.

Ich schlage **6 strikt sequenzielle Cuts** vor. Jeder Cut ist eigenständig lieferbar, baut auf Cut 1.1 auf und nutzt **ausschließlich** bestehende SSOTs (`agent_outcome_bundles`, `vertical_dna`, `auto_heal_log`, `runtime_safe_actions`, `conversion_events`, `notification_events`) — **keine Parallel-Systeme**.

---

## Cut 2.1 — Business Intent Layer (Fundament)

**Warum zuerst:** Alle weiteren Cuts (Continuous Intelligence, Fix Loops, Outcome Impact) brauchen einen formalen Ort für "Warum existiert dieses Projekt?". Ohne Intent-SSOT bauen wir wieder Bauchgefühl-Agenten.

**Neu:**
- Tabelle `business_intents` (intent_key UNIQUE, vertical_key, goal, target_kpi_json, monetary_impact_eur, risk_level, governance_level, no_go_constraints jsonb, owner_actor_id)
- Bridge `agent_outcome_bundles.business_intent_id` (nullable, kein Fork)
- RPC `admin_register_business_intent` + `admin_list_business_intents` + `admin_link_bundle_to_intent`
- UI `/admin/berufs-ki/business-intents` (List + Editor + "Linked Bundles" Sektion)
- Audit-Contracts: `business_intent_registered`, `bundle_linked_to_intent`
- Outcome-Run-Edge erweitert: wenn `business_intent_id` mitkommt → Goal+KPI als System-Context an Agents

**NICHT in 2.1:** Auto-Inference von Intents, Multi-Tenant-Intents, Approval-Workflow für Intents.

## Cut 2.2 — Persistent Intelligence Memory (QA-Brain)

**Warum:** "Persistent QA Memory" ist der Moat. Aber: nur EINE Tabelle, nicht 8 — sonst Schema-Drift.

**Neu:**
- Tabelle `project_intelligence_memory` (memory_key UNIQUE, kind enum [`learning`, `quality_incident`, `conversion_pattern`, `workflow_failure`, `security_pattern`, `seo_pattern`, `architecture_decision`, `successful_experiment`], vertical_key, intent_id nullable, payload jsonb, confidence, source_run_id, source_bundle_id, evidence_refs jsonb, status [`active`,`superseded`,`retired`])
- View `v_intelligence_memory_recent` (per kind, last 50)
- RPC `admin_record_intelligence_memory` + `admin_retire_intelligence_memory(reason)` + `admin_list_intelligence_memory(kind, vertical)`
- Outcome-Run-Edge: zieht aktive Memories des Verticals als "Prior Learnings"-Context in die Agent-Calls
- UI Tab "Intelligence Memory" in OutcomeControlCenter (filterbar nach kind)
- Audit: `intelligence_memory_recorded`, `intelligence_memory_retired`

**NICHT in 2.2:** Auto-Generation von Memories (kommt 2.4), Embedding-Search, Cross-Project-Memory.

## Cut 2.3 — Continuous Outcome Intelligence (Read-Only Layer)

**Warum:** Bevor wir autonom fixen können, müssen wir **sehen**. SSOT-First: alles als Views/RPCs über bestehende Tabellen.

**Neu (keine neuen Tabellen):**
- View `v_bundle_outcome_impact` (joint `agent_outcome_bundles` × `conversion_events` × `notification_events` × `auto_heal_log` über `intent_id`/`vertical_key`/`time_window`)
- View `v_vertical_health_signals` (per vertical: avg completeness, applied_rate_7d, risk_tier distribution, intent_coverage_pct)
- View `v_intent_kpi_progression` (Baseline → letzte 4 Messpunkte → Trend pro Intent.target_kpi)
- RPCs `admin_get_outcome_impact_summary(intent_id|vertical|bundle_id)` + `admin_get_vertical_health_signals()` + `admin_get_intent_kpi_progression(intent_id)`
- Neue Page `/admin/berufs-ki/outcome-mission-control` (Hero: Vertical-Health-Heatmap, KPI-Progression-Trend, Intent-Coverage-Matrix)
- Komponenten: `VerticalHealthHeatmap`, `IntentKpiProgressionChart`, `OutcomeImpactPanel`

**NICHT in 2.3:** Auto-Alerts, Fix-Vorschläge (kommt 2.4), Realtime-Subscriptions.

## Cut 2.4 — Autonomous Fix Loop (HITL-gated)

**Warum:** Der "Continuous Intelligence"-Claim wird hier konkret. **Hard Rule:** keine autonomen Writes — alles via `runtime_safe_actions` mit Reason ≥8 + HITL.

**Neu:**
- Tabelle `outcome_fix_proposals` (proposal_key UNIQUE, source_signal [`kpi_regression`,`conversion_drop`,`workflow_stall`,`risk_spike`,`intent_drift`], detected_at, intent_id, bundle_id nullable, root_cause_hypothesis text, proposed_action_key (→ runtime_safe_actions), confidence, impact_estimate jsonb, status [`detected`,`triaged`,`approved`,`applied`,`rejected`,`rolled_back`])
- Detector-Edge `berufs-agent-fix-detector` (Cron 30min) — liest `v_vertical_health_signals` + `v_intent_kpi_progression`, erzeugt Proposals via deterministischen Heuristiken (kein LLM-Auto-Trigger)
- HITL-RPC `admin_decide_fix_proposal(_id, _decision, _reason)` (Reason ≥8) — bei `approved` dispatched auf bestehende `admin_dispatch_runtime_safe_action`
- AFTER-Trigger: bei `status='applied'` schreibt automatisch `project_intelligence_memory` (kind=`successful_experiment` oder `quality_incident`)
- UI Tab "Autonomous Fix Queue" mit Risiko-Badge, Impact-Estimate, Decision-Dialog, Timeline
- Audit-Contracts: `fix_proposal_detected`, `fix_proposal_decided`, `fix_proposal_applied`, `fix_proposal_rolled_back`

**NICHT in 2.4:** Auto-Apply ohne HITL (Architekturregel #10 verbietet das), generative Fix-Code-Erzeugung, Self-Healing in Production.

## Cut 2.5 — Realistische Persona-Simulation

**Warum:** "Org-and-human Testing" als zweiter starker USP. Aufsetzen auf Vertical-DNA-Stakeholder-Map (existiert in `vertical_dna`).

**Neu:**
- Tabelle `persona_simulation_runs` (run_key UNIQUE, bundle_id, vertical_key, persona_role (aus vertical_dna.stakeholder_map), persona_context jsonb [motivation, frustration, time_pressure, expertise_level], scenario_prompt, simulated_journey jsonb, friction_points jsonb, abandonment_risk_pct, ux_clarity_score, business_risk_flags jsonb, status)
- Edge `berufs-agent-persona-simulate` — nutzt Lovable AI (`google/gemini-3-flash-preview`) mit System-Context = Vertical-DNA + Persona-Role + Bundle-Artifacts; gibt strukturierte Journey + Friction zurück
- RPCs `learner_request_persona_sim` (nur Self), `admin_get_persona_sim(bundle_id)`, `admin_list_persona_sims_per_intent`
- UI Tab "Persona Simulation" in BundleDetail — pro Stakeholder eine Karte: Journey-Timeline, Friction-Heatmap, Business-Risk-Flags
- Audit: `persona_simulation_requested`, `persona_simulation_completed`

**NICHT in 2.5:** Voice-Simulation, Multi-Persona-Konversation, Live-User-Tests, A/B-Persona-Routing.

## Cut 2.6 — Mission Control Premium UX

**Warum:** Aus den 5 Backbones einen kohärenten Enterprise-Look formen. **Nur UI-Konsolidierung** — keine neue Logik.

**Neu:**
- Restyle `/admin/berufs-ki/outcome-mission-control` als Cockpit-Hero (Tokens: `text-foreground`, `bg-card`, `shadow-elev-2`, Petrol/Mint-Identität aus `mem://design/berufos-masterbrand-v1`)
- 4 Top-Tiles: Outcome Health · Risk Radar · Fix Queue Status · Intelligence Memory Pulse
- Sektionen: Vertical-Heatmap · Intent-KPI-Trends · Active Fix Proposals · Recent Persona Insights · Live Audit-Timeline
- App-Top-Nav-Eintrag `Mission Control` (zwischen `AI Runtime` und `Growth`)
- Empty/Loading/Error-States über alle 4 Tiles
- Smoke-Test `scripts/berufagentos-v2-mission-control-smoke.mjs`

**NICHT in 2.6:** PDF-Export des Cockpits, Realtime-Subscriptions, Mobile-Optimierung (folgt eigener Cut).

---

## Architekturkonformität (alle 6 Cuts)

- **SSOT-First:** erweitert `agent_outcome_bundles`, `vertical_dna`, `runtime_safe_actions`, `auto_heal_log`, `conversion_events`, `notification_events` — keine Parallel-Systeme
- **Bridge-Don't-Fork:** alle neuen Tabellen via FK an bestehende SSOTs gebunden
- **Auditable Mutations:** alle Mutationen via `fn_emit_audit`; jeder Contract vorher in `ops_audit_contract` registriert
- **Security Inherits:** alle Admin-RPCs `SECURITY DEFINER` + `has_role(auth.uid(),'admin')`; alle Learner-RPCs scopen auf `auth.uid()`
- **No Autonomous Production Writes:** Cut 2.4 Fix-Loop ist HITL-gated; Detector schreibt nur Proposals, keine Mutations
- **No Hidden State:** alle neuen Felder/Views in Mission Control sichtbar
- **Market-Activation-Kriterium:** Cut 2.1+2.3+2.6 sind direkt Demo-tauglich (Sales-USP "Outcome Intelligence"); 2.2+2.4+2.5 sind Premium-Tiefenhebel

## Reihenfolge (zwingend sequenziell)

```text
2.1 Business Intent    →   2.2 Memory   →   2.3 Continuous Intelligence
                                                       ↓
                          2.6 Mission Control UX  ←   2.4 Fix Loop   →   2.5 Persona Sim
```

2.6 darf erst NACH 2.4+2.5 starten — sonst leeres Cockpit.

## Explizit NICHT in v2 (Scope-Schutz)

- Multi-Tenant-Workspace-Isolation
- Voice/Video-Persona-Simulation
- Cross-Project-Intelligence-Memory
- Auto-Code-Generation als Fix-Action
- Realtime-Subscriptions im Mission Control
- Mobile-First-Cockpit
- Embedding-Search über Intelligence Memory

## Memory-Updates pro Cut

Nach jedem Cut: neue Feature-Memory `.lovable/memory/features/berufs-ki/v2-cut-2-x.md` + `mem://index.md` Eintrag in `## Memories`.

---

**Frage an dich:** Soll ich mit **Cut 2.1 — Business Intent Layer** beginnen (Migration + RPCs + UI + Audit-Contracts + Smoke), oder willst du an der Reihenfolge / am Scope noch etwas ändern?
