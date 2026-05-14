## Bestand (Audit-Ergebnis)

ExamFit hat bereits substantielle Programmatic-SEO-Infrastruktur:

- **Daten**: 485 Curricula, 18.871 Kompetenzen — die SSOT-Quelle für Hybrid-Generierung ist vollständig vorhanden.
- **Tabellen**: `seo_content_pages` (580 Pages, **nur** `page_type='persona_landing'` für 3 Personas), `seo_templates` (key/doc_type/outline/prompt/qc_rules), `seo_generation_jobs` (queue/model/cost/logs), `seo_content_briefs`, `seo_keywords` + `seo_keyword_clusters`, `seo_internal_link_suggestions`, `seo_refresh_queue`.
- **Routing**: `ProgrammaticSEODispatcher.tsx` + `PersonaLandingPage.tsx` + `DynamicProductLandingPage.tsx`.
- **Pipeline**: `seo_generation_jobs` orchestriert bereits Generate/Refresh/Rewrite/Internal-Linking/QC/Publish.
- **Guards**: `fn_seo_pages_no_dead_end` Trigger, `v_seo_canonical_drift`, `v_seo_dead_end_drift`, `v_seo_refresh_candidates`.

## Lücke

Die Engine kann heute nur **persona_landing pro Paket × Persona**. Es fehlt komplett:

1. **Intent-Taxonomie** (Money / Angst / Erfahrung / Vergleich / Lernzeit / Longtail) in `seo_templates` und `seo_content_pages`.
2. **Kompetenz-Granularität**: `seo_content_pages` kennt `package_id`/`curriculum_id`, aber **keine** `competency_id`. Dadurch sind Mini-Landingpages „pro Kompetenz × Intent" nicht modellierbar — und genau das ist der Hebel (18.871 Kompetenzen × 6 Intents = theoretisch 113k Pages, real cap-gesteuert).
3. **Hybrid-Generator**: Es gibt keine Edge-Function, die SSOT-Skelett (H1/H2/FAQ/Breadcrumb/Schema aus Curriculum+Competency+Statistiken) deterministisch baut und nur einzelne Sektionen per Lovable AI mit Strict-RAG füllt.
4. **Dispatcher-Erweiterung**: `ProgrammaticSEODispatcher` routet aktuell nur Persona-Landings.
5. **Sitemap- und Hub-Spoke-Verlinkung** für die neuen Intent-Pages.

## Slice 1 (dieser Loop) — Foundation, kein Bulk

Ziel: Pipeline für **1 Intent (Pruefungsfragen) × 1 Top-Curriculum (z.B. AEVO)** Ende-zu-Ende grün, alle Guardrails an. Erst danach Multi-Intent + Bulk.

### 1. Schema-Migration (eine Concern-Einheit)

- `ALTER TABLE seo_content_pages ADD COLUMN competency_id uuid REFERENCES competencies(id), ADD COLUMN intent_template text, ADD COLUMN sections_json jsonb DEFAULT '{}', ADD COLUMN quality_score numeric, ADD COLUMN last_generated_at timestamptz, ADD COLUMN generation_source text DEFAULT 'hybrid_ssot_ai';`
- Neuen Unique-Index: `(curriculum_id, competency_id, intent_template, persona_type)` partial WHERE competency_id IS NOT NULL — verhindert Duplicates ohne den bestehenden persona_landing-Index zu brechen.
- Neue Page-Types in `seo_templates` über CHECK-Erweiterung von `doc_type` um `intent_page` (oder neue Spalte `intent_key`).
- 6 Templates seeden: `intent_pruefungsfragen`, `intent_typische_fehler`, `intent_durchfallquote`, `intent_wie_schwer`, `intent_erfahrung`, `intent_lernplan` — jeweils mit `outline_json` (deterministische Sektionen) + `prompt_system` (Style-Guide: keine Floskeln, keine KI-Phrasen, IHK-Prüfer-Tonalität) + `qc_rules_json` (min_words, must_contain_entities, max_filler_words).

### 2. SSOT-Skelett-Funktion (DB)

`fn_seo_build_ssot_skeleton(curriculum_id uuid, competency_id uuid, intent text) RETURNS jsonb`

Liefert deterministisch:
- `h1`, `meta_description`, `breadcrumbs` (Curriculum-Hierarchie)
- `faq_seed` (aus Competency-Tags + typische Suchanfragen-Vorlagen pro Intent)
- `internal_links` (Top-5 Sibling-Competencies + Hub-Page + Quiz-Trainer-Einstieg + AI-Tutor-Einstieg) aus dem Competency-Graph
- `stats` (z.B. Pool-Size, Score-Verteilung — falls vorhanden)
- `cta_block` (Trainer/Quiz/Produkt — geroutet pro Intent)

Kein AI-Call. Pure SQL. Wiederverwendbar von beiden — Edge-Function und ProgrammaticSEODispatcher.

### 3. Edge Function `seo-intent-page-generator`

- Input: `{ curriculum_id, competency_id, intent_template, persona_type }`
- Schritt 1: ruft `fn_seo_build_ssot_skeleton` → Skelett
- Schritt 2: Lovable AI Gateway (`google/gemini-3-flash-preview`) füllt **nur** drei Sektionen: `intro_paragraph`, `pain_point_paragraph`, `expert_tip` — mit Strict-RAG-Prompt: Eingabe = Curriculum-Titel + Competency-Beschreibung + Intent-Style-Guide. Verbotene Floskeln-Liste im System-Prompt.
- Schritt 3: Quality-Gate (Wortzahl, Verbotene-Phrasen-Regex, Entity-Check)
- Schritt 4: `INSERT ... ON CONFLICT (curriculum_id, competency_id, intent_template, persona_type) DO UPDATE` mit `status='draft'`, `quality_score`, `sections_json`
- Schritt 5: Audit in `auto_heal_log` (`action_type='seo_intent_page_generated'`)
- Cost-Cap: max 1 Generation pro Aufruf. Job-Queue-Integration via `seo_generation_jobs` (job_type='generate', template_key='intent_<x>', target_ref={curriculum_id, competency_id, intent, persona}).
- `verify_jwt = false` ist ok — nur via Service-Role-RPC `admin_enqueue_seo_intent_generation` aufrufbar (has_role-Gate).

### 4. Routing + Page-Komponente

- Route hinzufügen: `/lernen/:curriculumSlug/:intentKey/:competencySlug` → erweitert `ProgrammaticSEODispatcher` um Intent-Branch
- Eine neue Page `IntentLandingPage.tsx` rendert `sections_json` + interne Links + CTA + JSON-LD (Article + FAQPage + BreadcrumbList)
- `react-helmet-async` für per-Route Title/Description/Canonical
- Status-Filter: zeigt nur `published` Pages, sonst 404

### 5. Smoke-Test (synthetisch)

- 1 Curriculum (AEVO), Top-3-Kompetenzen, 1 Intent (`intent_pruefungsfragen`) → 3 Pages generieren → manuell auf Quality prüfen → veröffentlichen → Sitemap-Eintrag verifizieren → interne Links klick-testbar.

### Bewusst NICHT in Slice 1

- Keine Cron-Bulk-Generation (kommt in Slice 2 nach manueller QC der ersten 3 Pages)
- Keine restlichen 5 Intents (kommen pro Slice einzeln dran, jeweils mit eigenem Style-Guide-Tuning)
- Keine Topical-Authority-Map / Gap-Analyse (kommt in Slice 3, sobald >50 Intent-Pages live sind)
- Keine Hub-Pages „Wirtschaftsfachwirt Prüfungsfragen" (kommt in Slice 4 — die brauchen die Spokes als Voraussetzung)

## Risiken & Mitigationen

- **Scale**: 113k mögliche Pages → harter WIP-Cap pro Cron-Lauf (10/h initial), Quality-Gate-Schwelle ≥80, Refresh-Cooldown 30 Tage. Dead-End-Trigger ist bereits aktiv.
- **Duplicate Content**: SSOT-Skelett zwingt Strukturunterschiede pro Intent; Style-Guide-Prompt verbietet Floskeln; 3 unterschiedliche AI-Sektionen pro Intent.
- **Hosting-Constraint**: Lovable Hosting kann keine per-Route-Prerender — Pages sind initial nur in Sitemap + via JS gerendert. Voll wirksam erst nach Vercel-Migration (Runbook existiert bereits).
- **Migration-Discipline**: Eine Migration = ein Concern (Schema), separate Migration für Templates-Seed, separate für RPC, separate für Cron (später).

## Liefer-Reihenfolge dieses Loops

1. Migration: Schema-Erweiterung `seo_content_pages` + Unique-Index
2. Migration: 1 Template seeden (`intent_pruefungsfragen`)
3. Migration: `fn_seo_build_ssot_skeleton` + RPC-Wrapper `admin_enqueue_seo_intent_generation`
4. Edge Function `seo-intent-page-generator` + Deploy
5. `IntentLandingPage.tsx` + Route in `ProgrammaticSEODispatcher`
6. Sitemap-Generator-Erweiterung um die neuen Routes
7. Manueller Smoke: 3 Pages generieren, QC prüfen
8. Memory-Update + kurzer Status

Zeitschätzung: 1 voller Loop. Slice 2 (5 weitere Intents + Cron) im nächsten Loop, wenn die ersten 3 Pages QC bestanden haben.