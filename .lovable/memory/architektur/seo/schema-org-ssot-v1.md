---
name: Schema.org SSOT v1 (P3)
description: JSON-LD Builders für Pillar/Satellite-Schema aus KnowledgeGraph + Grounding-Layer, deterministic, mit Contract-Guard
type: feature
---
P3 — `src/lib/seo/schema/` SSOT für strukturierte Daten.

Module:
- types.ts — SCHEMA_CONTEXT, JsonLdObject, SchemaBuilderContext, SCHEMA_LAYER_VERSION 1.0.0.
- builders.ts — atomare Builder: BreadcrumbList, FAQPage (aus GroundedFaqItem[]), QAPage, DefinedTerm/DefinedTermSet, Course, EducationEvent, WebPage-Anchor + composeSchemaGraph (sortiert nach @id/@type, strippt inner @context).
- PillarSchema.ts — buildBerufPillarSchema (WebPage+Course+DefinedTermSet+EducationEvent×N+FAQPage+BreadcrumbList), buildKompetenzSatelliteSchema, buildPruefungSatelliteSchema, buildEntitySchema (dispatch), serializeSchema. competenciesOfBeruf walked beruf→lernfeld→kompetenz (P1 hat keinen direkten edge).
- contract.ts — assertSchemaContract: @context Pflicht, @id Pflicht auf {WebPage,Course,DefinedTermSet,QAPage,EducationEvent}, Marketing-Phrases (garantiert/100%/beste) verboten.

Hard Rules:
- Hand-rolled JSON-LD außerhalb `src/lib/seo/schema/**` blockiert via scripts/guards/seo-schema-ssot.mjs (PATTERNS: `application/ld+json` + `"@type":"Course|FAQPage|QAPage|DefinedTerm|DefinedTermSet|BreadcrumbList|EducationEvent"`). Baseline 7 Legacy-Files in seo-schema-ssot.baseline.json (Breadcrumbs, SEOHead, seoRoutes, EnterpriseDemoPage, IntentLandingPage, PillarLandingPage, ThemenHubPage).
- Examiner-Werte nie hier rechnen — kommen via P2-Grounding-Layer.

CI: .github/workflows/seo-schema-ssot.yml.
Tests: src/__tests__/seo-schema.golden.test.ts (9/9 grün) — Determinismus, Pillar-Composition, Satellite-Composition, @id-Guard, Marketing-Guard, Dispatcher.
