---
name: W1 Cut 1 — Semantic Gravity Foundation
description: src/lib/semantic extended um 5 EntityKinds (lernpfad, karrierepfad, tutor_topic, oral_exam_topic, faq) + 6 EdgeKinds + 5 Resolver (relatedLernpfade/Karrierepfade/TutorTopics/OralExamTopics/Faqs). ReadinessSignalBlock + SemanticRelatedLinks auf EntityPillarPage. 14 Golden-Tests grün.
type: feature
---

## Scope
W1-Cut-1 (Authority + Conversion Convergence). Reine TS/Frontend-Erweiterung; keine DB-Migration (Snapshot heute leer — additive Types reichen, RPC bleibt rückwärtskompatibel).

## SSOT
- `src/lib/semantic/types.ts`: EntityKind +5 (lernpfad, karrierepfad, tutor_topic, oral_exam_topic, faq). EdgeKind +6 (kompetenz_has_lernpfad, lernpfad_leads_to_produkt, beruf_has_karrierepfad, kompetenz_has_tutor_topic, pruefung_has_oral_exam_topic, entity_has_faq).
- `src/lib/semantic/resolvers.ts`: relatedLernpfade, relatedKarrierepfade, relatedTutorTopics, relatedOralExamTopics, relatedFaqs.
- `src/lib/semantic/PillarTypes.ts`: ENTITY_TO_PILLARS erweitert (oral_exam_topic → muendliche_pruefung_pillar; andere → []).
- `src/lib/semantic/KnowledgeGraph.ts`: stats().by_kind erweitert.

## UI
- `src/components/semantic/ReadinessSignalBlock.tsx` — Modes landing|product|learner. USP-Positionierung "Prüfungsreife-System".
- `src/components/semantic/SemanticRelatedLinks.tsx` — Tail-Block "Das könnte in deiner Prüfung drankommen". 5 Buckets (Kompetenzen/Risiken/Fehler/Mündlich/FAQ).
- `src/pages/wissen/EntityPillarPage.tsx` — beide eingebaut (Readiness nur für beruf/pruefung).

## Tests
- `src/__tests__/semantic-graph.golden.test.ts`: +5 Tests (W1_SNAP). 14/14 grün.

## Hard rules
- Examiner-Isolation unverändert: semantic darf nie readiness/verdict/confidence berechnen. ReadinessSignalBlock ist pure Presentation — Werte kommen vom Caller (Handover Contract).
- Edge-Dedup + deterministische Sortierung weiter via KnowledgeGraph-Constructor.

## Defer (Cut 1b)
DB-Migration `semantic_graph_get_published()` + Snapshot-Tabelle um neue Kinds/Edges erweitern, sobald erste Produktions-Inhalte (lernpfad/faq/tutor_topic) angeliefert werden.

## Next
- Cut 2: Intent Routing Engine (`src/lib/intent/router.ts`) + TrustLayerStrip.
- Cut 3: Internal Link Intelligence (seo_content_graph bidirektional) + Conversion-Trigger-Engine + FAQ-Generator + Persona-Hero-Slots.
