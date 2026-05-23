---
name: Architectural Continuity Guard v1.3
description: Semantic System Metadata + 2 neue Prinzipien (HEALABILITY_IS_REQUIRED, EVENT_DRIVEN_BY_DEFAULT) + pure Semantic Runtime Graph + read-only DB-Mirror-View. Plattform-Sprung von Regeln zu Regelverständnis.
type: feature
---

# Architectural Continuity Guard v1.3

Erweitert v1.2 um drei vernetzte Schichten (Plattform-Sprung):

## A. Semantic System Metadata
`src/lib/governance/known-systems.ts` erweitert um optionale Felder pro System:
- `domain` (governance|queue|audit|marketing|content|seo|security|auth|runtime|license|notification)
- `ownership` (z.B. `platform-ops`, `marketing-loop-c`, `seo-knowledge-os`)
- `neighbors[]` (gerichtete Kanten im Runtime-Graph)
- `healing_context: { replayable, recoverable, auditable, observable, drift_detectable, recovery_path? }`
- `drift_context: { drift_signal, drift_when }`
- `event_contracts[]` (event_type/intent_keys, die das System emittiert/konsumiert)
- `audit_actions[]` (action_types nach `auto_heal_log`)
- `governance_tier` (`core` | `extension` | `helper`)

Helper: `findSystemByName`, `healabilityScore(sys)` (0..5).

## B. Zwei neue Architekturregeln (architecture-rules.ts)
- **HEALABILITY_IS_REQUIRED** (hard): Jeder Schreibpfad muss replayable + recoverable + auditable + observable + drift_detectable sein. Block bei ≥3 missing oder fehlendem `auditable`/`drift_detectable`. Sonst warn.
- **EVENT_DRIVEN_BY_DEFAULT** (soft): Cross-Domain-Touches ohne `emits_events`/`consumes_events`/`isBridgeAdapter` warnen. Empfiehlt conversion_events / notification_events / system_intents / fn_emit_audit als Kanal.

`ArchitectureProposal` + `RuntimeActionPlan` tragen jetzt `healability`, `emits_events`, `consumes_events`, `isBridgeAdapter`. Adapter bleibt pure.

## C. Semantic Runtime Graph
`src/lib/governance/semantic-runtime-graph.ts` — pure deterministische Derivation:
- Nodes (kind/domain/ownership/degree_in/out/healability_score/has_drift_signal)
- Edges (3 Typen: `neighbor` | `event` | `audit`)
- Metrics: total counts, domains, orphans, hubs (degree≥3, top 8), cascade_risks (BFS-reach, top 10), unhealable, cross_domain_coupling
- Default-Input: `KNOWN_SYSTEMS`, injektabel für Tests

Output deterministisch (alle Sortierungen by name).

## D. UI-Tab "Runtime Graph" (read-only)
`/admin/governance/architecture` → 3. Tab. Zeigt Stats, Domains, Hubs, Cascade-Risks, Unhealable, Cross-Domain-Coupling, vollständige Node-Tabelle. Copy-Graph-as-JSON. Keine Mutation.

## E. Read-only DB-Mirror View
Migration `v_known_systems_semantic_graph` als VALUES-basierte View (21 Systeme).
- TS bleibt SSOT, View nur Spiegel via Migration.
- `REVOKE FROM PUBLIC,anon,authenticated`, `GRANT TO service_role`.
- Admin-RPC `admin_get_known_systems_semantic_graph()` (SECURITY DEFINER + has_role-Gate, EXECUTE for authenticated).
- Verwendung: SQL-Joins für Audit-Korrelation in zukünftigen Reports.

## Tests
- `architecture-review.test.ts` v1.1 — 7 Tests grün (Bridge-View jetzt review_required statt approved durch EVENT_DRIVEN_BY_DEFAULT warn — Test deckt das ab).
- `runtime-proposal-adapter.test.ts` — 4 Tests grün.
- `memory-sync.test.ts` — 5 Tests grün.
- `v13-rules.test.ts` — 6 Tests neu (HEALABILITY block/approved/view-skip + EVENT_DRIVEN warn/bridge/event).
- `semantic-runtime-graph.test.ts` — 7 Tests neu (determinism, audit hub, cascade ordering, cross-domain, orphan, unhealable).
- Total: **29/29 grün**.

## Leitplanken (eingehalten)
- Review-Core bleibt pure (kein Supabase-Import in TS-Modulen).
- Keine DB-Writes aus dem Guard. Nur Read-only View + Read-only RPC.
- TS-Registry bleibt einziger SSOT — DB-View ist Mirror, kein zweites SSOT.
- known-systems.ts bleibt Registry-SSOT — Metadaten ergänzen, ersetzen nichts.
- UI bleibt Preflight + Visualisierung, kein Execution-Pfad.
- Bounded healing: Healability-Regel verlangt Recovery-Pfad, blockt aber keine autonome Mutation.

## Plattform-Sprung
v1.3 markiert den Übergang von "Wir haben Regeln" zu **"Die Plattform versteht ihre eigenen Regeln"**:
- Ebene 1: Infrastruktur (Tabellen, RPCs, Functions) — vor v1.0
- Ebene 2: Architektur-Regeln — v1.0
- Ebene 3: Evidence + CI Enforcement — v1.1
- Ebene 4: Runtime Integration + Memory Sync — v1.2
- **Ebene 5: Semantic Runtime Graph + Healability + Event-Coupling — v1.3**

Damit existieren erstmals semantische Beziehungen (Domain, Ownership, Neighbors, Healing, Drift, Events) als deterministisch derivierbarer Graph — Voraussetzung für späteres Runtime Reasoning, Replay, Failure Propagation Analysis.

## v1.4 (geplant)
- CI-Drift-Guard: TS-Registry vs SQL-View Parität (`scripts/guards/known-systems-mirror-drift.mjs`).
- Persistente `architecture_review_run` via `fn_emit_audit` (kein neues SSOT).
- Optional: Graph-SVG-Rendering im UI (heute nur Tabellen).
