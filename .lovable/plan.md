## Sprint: SEO Wave 4 + Pillar/Hub Foundation v1

Zwei parallele Tracks, ein Sprint, kein Infrastrukturumbau.

---

### Track A — SEO Wave 4 (Intent-Spokes skalieren)

**Scope**
- 6–10 nächste published Curricula × 4 Intents (`pruefungsfragen`, `typische_fehler`, `durchfallquote`, `lernplan`)
- Auswahl via `seo_content_priority_queue` (Semrush-Volumen ≥ Schwelle, FAQ ≥ 3, thin-content-guard grün)
- Enqueue ausschließlich via `admin_seo_wave_enqueue_one` (SSOT, Idempotency-Key, Single-Row-Insert pro Call) — keine Multi-Row-INSERTs in `job_queue` für `seo_intent_page_generate`
- Pflicht-Audit `auto_heal_log.action_type = seo_wave_enqueue_attempt` pro Call

**Akzeptanz**
- 24–40 neue Intent-Pages, QC ≥ 90, in Sitemap, klickbar, Helmet-JSON-LD valid
- 0 Silent-Drops im neuen Healer-Audit
- Smoke `scripts/repro/audit-enqueue-silent-drop-repro.mjs` grün

---

### Track B — Pillar/Hub Foundation v1 (neu)

**Schema (eine Migration)**
- `seo_content_pages.page_type` Enum erweitern um `pillar_page`
- View `v_seo_pillar_candidates`: published Curricula mit ≥ 3 Intent-Spokes + Semrush head_general Volumen ≥ 2.000
- RPC `admin_register_pillar_page(curriculum_id)` — SECURITY DEFINER, has_role admin, Audit `pillar_page_registered`
- RPC `get_published_pillar_page(curriculum_slug)` — public, nur `quality_score ≥ 80 AND status = published`

**Edge Function `seo-pillar-page-generator`**
- Input: `{curriculum_id}` aus `job_queue` Job-Type `seo_pillar_page_generate` (registriert in `ops_job_type_registry`)
- Lädt: Curriculum-Overview, Prüfungsstruktur, Lernfelder, alle approved Competencies, alle veröffentlichten Intent-Spokes (Hub→Spoke Links)
- Lovable AI Gateway (`google/gemini-3-flash-preview`), Strict-RAG, generiert 4 Sektionen: `intro`, `pruefungsablauf`, `lernfeld_overview`, `typische_fehler_summary`
- Hard QC-Gate: H1, Breadcrumbs, ≥ 6 interne Links zu Intent-Spokes, FAQ ≥ 5, CTA „Prüfung starten“, Floskel-Filter, Wortzahl ≥ 800

**Frontend Route `/kurse/:curriculumSlug`**
- Komponente `PillarLandingPage.tsx`
- Helmet: Title, Meta, Canonical, BreadcrumbList + CollectionPage + FAQPage JSON-LD
- Render: Hero, Curriculum-Overview, Prüfungsstruktur, Lernfeld-Grid, Spoke-Liste via `<SEOInternalLinks linkTypes={['cluster_to_cluster']} />`, CTA → Prüfungstrainer
- `ProgrammaticSEODispatcher`: 1-Segment `/kurse/:slug` → Pillar; 3-Segment bleibt Intent (bestehende Route)

**Internal-Link-SSOT v2 (Mini-Patch, nicht voller v2-Umbau)**
- Nach Pillar-Publish: `seo-internal-linker` Run zwingen, der pro Curriculum genau 1 `cluster_to_pillar` Edge je Spoke schreibt (`source_url = Spoke`, `target_url = /kurse/<slug>`)
- Idempotenz via bestehenden Unique Key `(source_url, target_url, link_type)`, status `active`
- Audit `seo_internal_linker_run` mit `pillar_links_upserted`

**Sitemap**
- `load-dynamic-routes.mjs` erweitert: Pillar-Pages aus `seo_content_pages WHERE page_type='pillar_page' AND status='published' AND quality_score >= 80`
- `lastmod = last_generated_at`, Audit `seo_pillar_sitemap_updated`

**Smoke (in diesem Sprint)**
- 3 Pillar-Pages: Fachinformatiker Systemintegration, Industriekaufmann, AEVO
- enqueue → completed → URL klickbar → JSON-LD valid → in Sitemap → ≥ 6 Spoke-Links sichtbar
- Audit `seo_pillar_smoke_completed`

---

### Reihenfolge

1. **Track B Schema + Edge Function** (Migration → Funktion → 1 Pillar AEVO als Canary)
2. **Track B Frontend + Sitemap** (Route + Smoke 3 Pillars)
3. **Internal-Linker Pillar-Mode** (Spokes → Pillar Edges)
4. **Track A Wave 4 Enqueue** (24–40 Spokes, parallel zur Pillar-Welle)

---

### Bewusst NICHT in diesem Sprint

- LLM-Visibility-Reprobe (P2, kommt nach 7-Tage-Index-Beobachtung)
- FAQ-Coverage-Backfill (P2)
- IndexNow/Recrawl-Acceleration (P3, erst > 150 Pages)
- Voller Internal-Link-Graph v2 Umbau (Mini-Patch reicht für Hub→Spoke)
- Cron für Pillar-Auto-Generation (erst nach 24 h Beobachtung)
- Vercel/Hosting-Wechsel

---

### Risiken

- **Pillar-QC-Drift**: head_general Terms verleiten zu generischen Texten → Floskel-Filter strenger als bei Intent-Pages (Wortzahl ≥ 800, Pflicht-Token aus Curriculum-Titel + Lernfeldnamen)
- **Spoke→Pillar Link-Loop**: bidirektionale Pflicht-Edges nicht in v1 — nur Spoke→Pillar. Pillar→Spoke wird durch `<SEOInternalLinks>` Render-Hook abgedeckt, nicht via SSOT-Persistenz
- **Job-Type-Registrierung**: `seo_pillar_page_generate` MUSS via `ops_job_type_registry` (Canonical Identity Contract), sonst Bronze-Lock-Guard blockt

Bitte freigeben, dann starte ich mit **Track B Schema + Edge Function (Canary AEVO)**.
