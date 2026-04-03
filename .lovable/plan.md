## Content Automation Engine – Implementierungsplan

### Phase 1: Datenbank-Fundament
**Migration** mit zwei neuen Tabellen:
- `blog_articles` – SEO-Artikel mit Titel, Slug, Content (Markdown), Meta-Description, Keywords, Status (draft/published), `source_question_id`, `generated_at`
- `video_scripts` – Video-Skripte mit Hook, Body, CTA, Format-Typ (durchfall/mini_klausur/aha_moment), `source_question_id`, Status, Caption-Text

### Phase 2: SEO Blog-Agent (Edge Function)
- `content-blog-generate` Edge Function:
  - Zieht zufällige approved Fragen aus `exam_questions` (Studium-Fokus)
  - Generiert per Lovable AI (Gemini Flash) einen SEO-optimierten Blog-Artikel
  - Prompt: Frage → Erklärung → Transfer → Prüfungstipp → CTA
  - Speichert direkt als `published` in `blog_articles`
- Dynamische `/blog` Index-Seite + `/blog/:slug` Artikel-Seite
- Dynamische Sitemap-Erweiterung (`/sitemap-blog.xml`)

### Phase 3: Video-Skript-Agent (Edge Function)  
- `content-video-generate` Edge Function:
  - Zieht Fragen + Erklärungen aus dem Pool
  - Generiert Skript im gewählten Format (Durchfall-Realität / Mini-Klausur / Aha-Moment)
  - Speichert in `video_scripts` mit strukturiertem JSON (hook, problem, beispiel, twist, cta)
- Admin-Seite zum Triggern + Vorschau der generierten Skripte
- Remotion-basierte MP4-Generierung als separater Schritt (on-demand pro Skript)

### Phase 4: Cron-Automation
- Täglicher Cron-Job der beide Agents triggert (10 Blog-Artikel + 10 Video-Skripte)

### Nicht in Scope (bewusst):
- Automatische MP4-Massenproduktion (zu teuer/langsam für Cron → on-demand)
- Social Media Posting API (braucht externe Tokens)
