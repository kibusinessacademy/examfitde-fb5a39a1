---
name: SEO Knowledge-OS Audit v1 — Gap & Bridge Map
description: Mapping des 10-Layer-Knowledge-OS-Modells (Content Registry, Semantic Link Engine, Crawl/Index Governance, Authority Distribution, Intent Expansion, Conversion Routing, Freshness/Drift, Structured Data, AI Retrieval Optimization, Governance/Automation) gegen bestehende ExamFit-Infrastruktur. Identifiziert 2 strukturelle Gaps (Content Registry SSOT-Vereinheitlichung, Conversion Routing Layer) + 4 Bridge-Lücken. Reuse-first per Architectural Continuity Guard v1.2.
type: feature
---

## Executive Summary

ExamFit ist bereits ein semantisches OS in Teilen — nicht nur ein Publisher. Das 10-Layer-Modell ist zu **~80%** materialisiert. Die fehlenden 20% sind **Vereinheitlichung statt Neubau**.

**Top-Findings:**
1. **Content-SSOT ist fragmentiert** über `seo_documents` (239), `blog_articles` (267), `certification_seo_pages`, `seo_content_pages`, `profession_glossaries` (267), `product_persona_overlays` (198). → Bridge-View nötig, **keine** neue Tabelle.
2. **Conversion-Routing-Layer fehlt als deklarativer SSOT.** Routing existiert nur prozedural (CTA-Komponenten, A/B-Promotion). Kein `seo_conversion_route(source_doc → cta → next_doc → product)`-Mapping pro Knoten.
3. **AI Retrieval Optimization (Layer 9)** ist mit `src/lib/llm-grounding/` (Chunk-Builder, FaqGenerator, ExaminerEvidenceSerializer) bereits state-of-the-art — kein Gap.
4. **Internal-Authority-Network** ist stark: Pillar-Authority weighted, Graph-Metrics, Hubs, Orphan-Analysis (E3d.3). Bridge-Engine läuft (E3e.0–4 + Promotion-Watchlist).
5. **Crawl/Index-Governance** komplett: Canonical-Drift-Klassifikation, Sitemap-Per-Entity, Vercel-Prerender, GSC-Reconciliation P6.

## Layer-für-Layer Mapping

### L1 — Content Objects (Knoten) — ⚠️ FRAGMENTIERT
**Vorhanden (parallele SSOTs):**
- `seo_documents` (239) — generische SEO-Pages
- `blog_articles` (267) + `blog_posts` — Freshness-Layer
- `certification_seo_pages` — Pillar-Layer
- `seo_content_pages` + `seo_keyword_clusters` (215) + `seo_keywords` (307)
- `profession_glossaries` (267) — Entity-Layer
- `product_persona_overlays` (198) — Persona-Layer
- `course_packages` published (49) — Product-Layer

**Gap:** Kein einheitlicher `node_id, node_type, canonical_slug, pillar_id, status` View über alle 7 Object-Typen. Graph-Recon muss heute pro Tabelle einzeln joinen.

**Bridge-Vorschlag (reuse-only):** `v_seo_content_node_ssot` (View, kein Schema). Vereint alle 7 Quellen in `(node_id, node_type, canonical_url, pillar_id, status, updated_at)`. Keine neue Tabelle, keine Migration der Bestände. Speist Graph-Engine (L2) und Conversion-Router (L6).

### L2 — Semantic Link Engine — ✅ STARK
- `seo_internal_link_suggestions` (4578)
- `seo_bridge_*` Familie (activations 20, promotions 19, governance, candidates v1)
- `v_seo_graph_node_metrics` / `_metrics` / `_patterns` / `_hubs` / `_authority_summary`
- `v_pillar_contextual_bridge_candidates`, `v_intent_to_cert_pillar_bridge_candidates`, `v_persona_landing_cert_pillar_link_candidates`
- Strikte Typ-Trennung: `cluster_to_pillar` / `pillar_to_cluster` / `cluster_to_cluster` v1 (Memory `internal-link-graph-v2-direktive`)

**Mini-Gap:** `cluster_to_cluster v1` (Pair-Map) noch nicht aktiviert (`seo_intent_pair_map` Tabelle fehlt).

### L3 — Crawl & Index Governance — ✅ KOMPLETT
- `v_canonical_drift_classification_v1`, `v_seo_canonical_drift`, `v_canonical_package_drift`
- `seo_redirects` (0 Rows — leer aber Schema vorhanden)
- `seo_discovery_state`, `seo_submission_logs`
- Sitemap-Per-Entity (Blog, Paket, Pruefungstraining)
- GSC-Reconciliation Cockpit P6 Cut3+Cut5

### L4 — Authority Distribution Engine — ✅ STARK
- `v_seo_pillar_authority_weighted`, `v_seo_pillars`
- `v_pillar_orphans`, `v_pillar_orphan_classification`
- `v_seo_graph_hubs`, `v_seo_node_reach`
- E3d.3 Graph Impact Measurement v1 (Memory)

### L5 — Intent Expansion System — ✅ STARK
- `seo_keyword_clusters` (215) + `seo_keywords` (307)
- `seo_content_priority_queue` + Wave-Selector + Thin-Content-Guard
- `keyword-cluster-map-v2-coverage` (190/190 Curricula gemappt, Memory)
- Persona × Intent Bridge (A1 + A2 gebaut)

**Mini-Gap:** Persona-/Region-/Erfahrungslevel-Achsen sind nur partiell kombiniert (nur Persona aktiv, Region/Level liegen brach).

### L6 — Conversion Routing Layer — ❌ GAP (prozedural statt deklarativ)
**Vorhanden:** `conversion_events` (904), CTA A/B Auto-Promote, `cta_winner_decisions`, `v_conversion_cta_performance`, `v_seo_page_conversion`.

**Gap:** Keine deklarative `(source_node_id, intent, persona) → (cta_variant, next_node_id, product_id)`-Tabelle. Heute ist Routing in React-Komponenten (`QuizCTA`, `LeadQuizRunner`, `startProductCheckout`) hartkodiert + per A/B optimiert, aber nicht als Graph-Edge persistiert. Damit kann L1+L2 das Routing **nicht** im Graph mitführen.

**Bridge-Vorschlag (Cut-Kandidat):** `seo_conversion_route` Tabelle mit `(source_node_id, source_node_type, persona, cta_variant_id, next_node_id, product_id, weight, source_intent)` — gespeist aus bestehenden CTA-Decisions + Persona-Overlays. Erst View, dann Materialization. **Kein** neues CTA-System — bestehende `cta_winner_decisions` als Producer.

### L7 — Freshness & Drift Engine — ✅ STARK
- `v_pillar_content_stale`, `seo_refresh_queue` (0 — leer)
- `v_seo_dead_end_coverage`, `v_seo_dead_end_drift`
- `v_seo_canonical_drift`
- `seo_content_audits`
- `seo-cannibalization-guard.mjs` + `seo-dead-end-coverage-guard.mjs` + `pillar-routes-orphan-guard.mjs`

**Mini-Gap:** `seo_refresh_queue` ist leer — Producer (Stale-Detector → Queue) noch nicht verkabelt.

### L8 — Structured Data Layer — ✅ KOMPLETT (P3 abgeschlossen)
- `src/lib/seo/schema/` — Course, DefinedTerm, EducationEvent, FAQPage, Breadcrumb, Article, Organization
- `seo-schema-ssot.mjs` Guard mit Baseline-Waiver
- `JsonLdHead` Komponente

### L9 — AI Retrieval Optimization — ✅ KOMPLETT
- `src/lib/llm-grounding/` — DocumentBuilder, ExaminerEvidenceSerializer, FaqGenerator, hash, contract
- LLM-Visibility Cron 138 (10 Queries × 3 Models, weekly)
- `public/llms.txt` + `public/llms-full.txt`
- Examiner-Isolation enforced via `semantic-no-examiner-bypass` Guard
- AI Tutor Strict-RAG mit [SOURCES]-Pflicht

### L10 — Governance & Automation Layer — ✅ KOMPLETT
- 84 GitHub-Workflow-Guards, davon ~25 SEO-relevant
- Architectural Continuity Guard v1.2 (Preflight + Memory-Sync + Runtime-Adapter)
- `auto_heal_log` mit `fn_emit_audit` Audit-Contract
- `ops_audit_contract` Registry
- `seo_alert_thresholds` SSOT + `admin_set_seo_alert_threshold`
- Status-Revert-Guard, Phantom-Step-Guard, Bronze-Lock-Guard

## Echte Gaps (priorisiert)

| Gap | Layer | Severity | Bridge-Strategie | Reuse-Targets |
|-----|-------|----------|------------------|---------------|
| **G1: Content-Node-SSOT View** | L1 | high | View-only `v_seo_content_node_ssot` | seo_documents, blog_articles, certification_seo_pages, seo_content_pages, profession_glossaries, product_persona_overlays, course_packages |
| **G2: Conversion Routing Layer** | L6 | high | Deklarative Tabelle `seo_conversion_route` (gespeist aus cta_winner_decisions + persona_overlays) | conversion_events, cta_winner_decisions, product_persona_overlays |
| **G3: cluster_to_cluster v1 Pair-Map aktivieren** | L2 | medium | Tabelle `seo_intent_pair_map` (curated, 5 Pairs) + RPC `admin_seo_link_spoke_pairs` | seo_internal_link_suggestions |
| **G4: seo_refresh_queue Producer** | L7 | medium | Cron + Trigger: Stale-Detector → Queue-Insert | v_pillar_content_stale, seo_refresh_queue |
| **G5: Region/Erfahrungslevel-Intent-Achsen** | L5 | low | Persona-Achse erweitern (kein neues Schema) | seo_keyword_clusters, persona_landing |
| **G6: Lookalike/Comparison-Pages** | L1 | low | Neuer node_type in v_seo_content_node_ssot, kein neues Schema | bestehende Templates |

## Empfohlene Reihenfolge (sequenziell, kleine Cuts)

**Cut A — G1 Content-Node-SSOT View** (1 Migration, View-only, kein Risk)
→ unlocked Cross-Layer-Recon, speist G2 + G3 + Graph-Engine.

**Cut B — G4 Refresh-Queue Producer** (1 Migration + 1 Cron)
→ heilt L7 ohne neue Strukturen.

**Cut C — G2 Conversion Routing Layer** (1 Tabelle + 1 View + 2 RPCs + 1 Cockpit-Card)
→ größter Cut, aber rein deklarativ. Kein Touch an React-CTA-Komponenten in v1 (nur Persistierung der Decisions).

**Cut D — G3 cluster_to_cluster v1** (1 Tabelle + 1 RPC)
→ kleiner Authority-Booster, niedriges Risiko.

**Cut E — G5 + G6** (optional, nach Cut C-Wirkung gemessen)

## Hard No-Go (per Architectural Continuity Guard)
- **Keine** neue zentrale `seo_documents`-Replacement-Tabelle (Principle SSOT_FIRST + EXTEND_EXISTING).
- **Keine** parallele Conversion-Tracking-Tabelle (conversion_events bleibt SSOT, NO_PARALLEL_SYSTEMS).
- **Keine** Migration der Bestände in eine "Master-Content-Tabelle" — Bridge-View first (BRIDGE_DONT_FORK).
- **Keine** AI-Augmentation der CTA-Routing-Decisions in v1 — erst deklarative Persistenz, dann optionale Optimierung (GOVERNANCE_BEFORE_AUTOMATION).

## Vibe-OS-Leitregel (Translation)
Aus Audit ableitbar für **alle** neuen Vibe-OS-Projekte:
1. Content-Objekte typisiert + canonical_slug ab Tag 1
2. Internal-Link-Graph als Edge-Tabelle (nicht als String-Suche)
3. Sitemap-Per-Entity ab erster Sitemap
4. JSON-LD-Schema-SSOT in `src/lib/seo/schema/`
5. `llms.txt` + `llms-full.txt` ab erstem Deploy
6. CTA → conversion_events SSOT mit `package_id` Generated Column
7. CI-Guards für Canonical/Cannibalization/Orphans ab erstem Push
8. Architectural Continuity Guard als Preflight bei jedem neuen System
