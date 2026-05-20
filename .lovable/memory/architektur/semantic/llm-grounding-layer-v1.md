---
name: LLM-Grounding Layer v1 (P2)
description: Retrieval-first chunk/citation/FAQ serializers für SRO/LLM, examiner-pass-through, deterministic
type: feature
---
P2 — `src/lib/llm-grounding/` SSOT für AI-Citation + Retrieval.

Module:
- types.ts — GroundedChunk/Citation/GroundedFaqItem/GroundedDocument + GROUNDING_LIMITS (headline≤120, body≤1200, citations≥1).
- hash.ts — FNV-1a chunk_id/faq_id/document_id (byte-stable).
- contract.ts — assertChunkContract/assertFaqContract/assertDocumentContract (marketing-tone-Guard, contract_version=1.0.0 Pflicht).
- serializers.ts — serialiseBeruf/Pruefung/Kompetenz/Entity über KnowledgeGraph (definition/scope/exam_form/risk_profile/related_links).
- ExaminerEvidenceSerializer.ts — serialiseExaminerHandover liest readiness_state/confidence/trend/consistency/top_risks **verbatim**; nie recompute.
- FaqGenerator.ts — generateBerufFaqs/KompetenzFaqs deterministisch templated, kein LLM.
- DocumentBuilder.ts — buildGroundedDocument composes graph+examiner+faqs, dedupe by chunk_id, stable sort by (role,chunk_id).

Hard Rules:
- Jeder Chunk ≥1 Citation gegen contract_version "1.0.0".
- Marketing-Tone (garantiert/100%/beste) blockt via contract.
- Semantic-Guard scripts/guards/semantic-no-examiner-bypass.mjs deckt `src/lib/llm-grounding/**` ab → keine lokale readiness/confidence/verdict-Logik.

Tests: src/__tests__/llm-grounding.golden.test.ts (8/8 grün) — Determinismus, Examiner-Pass-Through, Marketing-Guard, Document composition.
