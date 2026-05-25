# W1 — Authority + Conversion Convergence

**Mission:** BerufOS erzeugt „semantic gravity" — Beruf, Prüfung, Kompetenz, Schwäche, Lernpfad, Produkt, Conversion sind als zusammenhängendes Ökosystem verstanden (von Google, Nutzer, AI).

W1 ist groß. Statt alles parallel zu reißen, baue ich es in **3 abgegrenzten Cuts** mit Smoke-Test + Memory-Update pro Cut. Cut 1 ist der einzige, der jetzt direkt umgesetzt wird — Cut 2 + 3 folgen nach Approval.

---

## Cut 1 — Semantic Gravity Foundation (jetzt)

Höchster Hebel, niedrigste Drift-Gefahr. Reine SSOT-Erweiterung + Read-Views, keine Producer-Mutationen.

### 1.1 Semantic Graph erweitern (P0)
Bestehender `src/lib/semantic` Graph deckt 10 Entity-Kinds ab (beruf, pruefung, lernfeld, kompetenz, risiko, fehlerbild, …). Fehlend für W1-Mission:
- `lernpfad` — sequenzierter Pfad aus Kompetenzen → Produkt
- `karrierepfad` — Beruf → Folge-Beruf / Weiterbildung
- `tutor_topic` — Bridge Kompetenz → AI-Tutor-Kontext
- `oral_exam_topic` — eigene Entity (heute nur als `oral_pattern` an Kompetenz)
- `faq` — strukturierte FAQ-Knoten (für AI-Overview + Schema.org)

Neue Edges:
- `kompetenz_has_lernpfad`, `lernpfad_leads_to_produkt`
- `beruf_has_karrierepfad`
- `kompetenz_has_tutor_topic`
- `pruefung_has_oral_exam_topic`
- `entity_has_faq` (polymorph via from-id)

**Golden-Tests** erweitern (Determinismus + Dedup + Examiner-Isolation bleibt hart).

### 1.2 DB-Snapshot-Pipeline anpassen
`semantic_graph_get_published()` RPC + Snapshot-Table um neue Kinds/Edges erweitern (additive Migration, keine Drops). Backfill: leer — Phase P5 Hook tolerant.

### 1.3 Readiness als sichtbarer USP (Quick-Win)
Bestehende `BerufReadinessBlock`-Komponente generalisieren zu `ReadinessSignalBlock` mit 3 Modi:
- `landing` (heute), `product`, `learner`
Einbau auf: Pillar-Pages (`/wissen/beruf/:key`), Produkt-Landing-Templates, Learner-Dashboard-Header. Reine Frontend-Arbeit, keine neuen Daten.

### 1.4 Semantic Related Links (Quick-Win)
Neue Komponente `<SemanticRelatedLinks entityId={…} kinds={…} />` — nutzt vorhandene `resolveTargets` + `relatedCompetencies`/`relatedMistakes`/`relatedOralPatterns`. Einbau am Fuß jeder Pillar/Satellite-Page. „Das könnte in deiner Prüfung drankommen".

### Smoke + Memory
- Vitest: Graph-Golden grün, neue Resolver-Tests
- Memory-Leaf `architektur/semantic/w1-cut1-graph-extension-v1.md`
- `mem://index.md` Core-Rule update

---

## Cut 2 — Intent Routing + Trust Layer (nach Approval Cut 1)

- **Intent Classifier** (deterministisch, regex-first + optional Lovable-AI fallback): `intent_key ∈ {bestehen, schwer, durchgefallen, muendlich, ihk_fragen, lernplan, simulieren, unsicher, angst, weiterbildung}` → `persona × cta × produkt × funnel_path`
- SSOT `src/lib/intent/router.ts` + Tests + DB-View `v_intent_routing_decisions`
- **Trust Signals** Komponente `<TrustLayerStrip />` (prüfungsnah, Rahmenplan, KI-Grenzen, no-halluzination) als wiederverwendbares Band

## Cut 3 — Internal Link Intelligence + Conversion Intelligence (nach Cut 2)

- Bidirektionale semantische Internal-Links via `seo_content_graph` Erweiterung (mündlich ↔ typische-fragen ↔ fallen ↔ readiness pro Beruf)
- Conversion-Trigger-Engine (Prüfungsdatum, Mastery-Drop, Session-Abbruch, Streaks) → `conversion_triggers` SSOT + Reaktoren in bestehenden Funnel-Komponenten
- FAQ-/Glossar-Generator aus Kompetenz-Graph (P2 AI-Retrieval)
- Persona-spezifische Hero-Slots (Azubi/Betrieb/Institution)

---

## Anti-Drift-Regeln (gelten für alle Cuts)
- Examiner-Isolation: semantic darf NIE readiness/confidence/verdict berechnen
- Keine neuen parallelen Systeme — alles erweitert bestehende SSOTs (`src/lib/semantic`, `seo_content_graph`, `course_packages`)
- Architectural Continuity Guard vor jedem neuen Table/RPC
- Audit über `fn_emit_audit` Pflicht für jeden Mutator

## Technical Details
- Migration additive (CREATE TYPE … ADD VALUE; ALTER TABLE ADD COLUMN IF NOT EXISTS)
- Neue Edge-Kinds als String-Union erweitert in `types.ts`
- ENTITY_TO_PILLARS erweitert in `PillarTypes.ts`
- Snapshot-RPC bleibt rückwärtskompatibel (neue Kinds = optional in Frontend-Konsumenten)

---

**Nächster Schritt nach Approval:** Cut 1 in einem Rutsch (Graph-Erweiterung + Migration + Readiness/RelatedLinks Einbau + Tests + Memory). Cut 2 + 3 folgen je nach Feedback.