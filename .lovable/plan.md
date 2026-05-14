# Slice 2 + Slice 3 Plan: SEO Intent Pipeline + Hybrid Keyword-Map

Slug-Normalizer-Bug ist gefixt (Slice-1.5, smoke 5/5 grün, audit `seo_intent_slug_normalizer_fixed` geschrieben). Ab hier in **drei Loops** mit Freigabe nach jedem.

---

## Loop A — Pipeline (Edge Function + QC + Persistenz)

**Edge Function `seo-intent-page-generator`**
- Input: `{job_id}` aus `job_queue`, lädt payload `{curriculum_id, competency_id, intent_key, persona_type}`.
- Ruft `fn_seo_build_ssot_skeleton(...)` für H1/Meta/Breadcrumbs/FAQ-Seed/Internal Links/CTA.
- Lädt `seo_templates` per `intent_key`, nutzt `prompt_system` + `qc_rules_json`.
- Lovable AI Gateway (`google/gemini-3-flash-preview`) generiert nur 3 Sektionen: `intro`, `pain_points`, `expert_tip`. Strict-RAG Kontext = Curriculum + Competency + Skeleton, kein Free-Floating.
- Persistiert in `seo_content_pages` (UPSERT auf unique `(curriculum_id, competency_id, intent_template, persona_type)`).
- Setzt `quality_score`, `generation_source='hybrid_ssot_ai'`, `generation_model`, `generation_cost_eur`, `last_generated_at`.
- Job → `completed`/`failed`, Audit `seo_intent_page_generated` oder `seo_intent_page_qc_failed`.

**Hard QC-Gate (server-side)**
Fail wenn: H1/Breadcrumbs/FAQ/CTA/InternalLinks/sections leer, Slug invalid, Floskel-Liste matcht (`In der heutigen Zeit`, `maßgeschneidert`, `Tauche ein`, `egal ob Anfänger oder Profi`, `Dieser Artikel zeigt dir alles`), Wortzahl<400, keine Curriculum-Token im Body.

**RPC `get_published_intent_page(curriculum_slug, competency_slug, intent_slug)`** — public, SECURITY DEFINER, liefert nur `quality_score>=80 AND status='published'`. Kein Client-Table-Read.

---

## Loop B — Frontend Route + Sitemap + Smoke

- `IntentLandingPage.tsx` an `/kurse/:curriculumSlug/:competencySlug/:intentSlug`.
- `react-helmet-async`: Title, Meta, Canonical, Article+FAQPage+BreadcrumbList JSON-LD.
- Render: H1, Breadcrumbs, Sections, FAQ-Accordion, `<SEOInternalLinks>`, CTA → Prüfungstrainer.
- `ProgrammaticSEODispatcher`: Erkennt `/kurse/...` 3-Segment-Pattern, fallback 404 ohne Kollision.
- Sitemap: `scripts/seo/run-prerender.mjs` + `load-dynamic-routes.mjs` lesen `seo_content_pages` (intent_page, published, score≥80) via REST, `lastmod=last_generated_at`. Audit `seo_intent_sitemap_updated`.
- **Smoke** (3 AEVO Pages: Prüfungsfragen, typische Fehler, mündliche Prüfung): enqueue → completed → URL klickbar → alle Pflicht-Elemente sichtbar → in Sitemap. Audit `seo_intent_smoke_completed`.

---

## Loop C — Hybrid Keyword-Map (SSOT + Semrush)

**Schritt C1 — SSOT-Skelett (deterministisch, kein API-Cost)**
- Migration: `seo_intent_templates` erweitern um 5 weitere Intents:
  - `pruefungsfragen`, `typische_fehler`, `muendliche_pruefung`, `durchfallquote`, `lernplan`, `vergleich` (variant per Kurs)
- View `v_seo_keyword_seed` = Top-N Curricula × Intents × Top-Competencies → ~500 Keyword-Heads (deterministisch aus DB).

**Schritt C2 — Semrush-Anreicherung (Top-15 Kurse first)**
- Liste der 15 wichtigsten Curricula manuell pinnen (AEVO, Handelsfachwirt, Bilanzbuchhalter, Betriebswirt, FIAE, FISI, Wirtschaftsfachwirt, Industriefachwirt, Scrum, Personalfachkaufmann, …).
- Pro Kurs × Intent → `semrush--keyword_research` (Volume/KDI/Long-Tail-Varianten + Question-Keywords).
- Persistiere in `seo_keywords` + `seo_keyword_clusters` (bestehende Tabellen!) mit `cluster_type='intent_pillar'`, `pillar_url`, `spoke_urls`.
- Output: Markdown-Report `/mnt/documents/keyword-cluster-map-v1.md` mit Hub-Spoke-Diagramm pro Kurs (welche Pillar-Page, welche Spokes, internal-link-targets).

**Schritt C3 — Bulk-Enqueue mit Cap**
- `admin_enqueue_seo_intent_generation_bulk(limit=10, min_score_floor=true)` — nur high-confidence Cluster, 10/h Cap, 30d Refresh-Cooldown. Kein Cron in diesem Loop.

---

## Risiken
- **Hosting**: Lovable SPA-Fallback blockt Per-Route-Prerender → Intent Pages erscheinen nur in Sitemap, nicht als statisches HTML (siehe SEO-Hosting-Constraint Memory). LLM-Crawler + Googlebot funktionieren via Helmet, Social-Crawler nicht. Migration zu Vercel offen.
- **Semrush Credits**: ~15 Kurse × 6 Intents = 90 `keyword_research`-Calls. Vorher Budget bestätigen.
- **AI-Floskel-Detection**: deterministisches Regex; falsch-positive auf legitime Phrasen möglich → Liste in DB, schnell anpassbar.

---

## Reihenfolge & Akzeptanz
1. **Loop A grün** (Edge Function liefert valid `sections_json` für 1 AEVO-Test-Page, QC-Gate sperrt absichtliche Floskel-Variante) → Freigabe.
2. **Loop B grün** (3 AEVO-Pages live klickbar + Sitemap + Helmet-JSON-LD validiert) → Freigabe.
3. **Loop C** in zwei Mini-Loops: erst C1+C2 (Keyword-Map als Report, kein Code-Push), dann C3 nach Review.

---

## Nicht-Ziele dieses Plans
- Cron für Auto-Generation (kommt erst nach 24h Production-Beobachtung)
- Vercel-Migration (separater Track)
- Bulk-Generation >10 Pages/Loop
- Topical Authority Map als Visualisierung (separater Track)

Bitte freigeben für **Loop A**, oder gegensteuern.