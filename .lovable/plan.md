
# Growth Engine — Vollausbau-Plan

## Phase 1: Datenbank-Fundament (Migration)

### Neue Tabellen
1. **`daily_question_picks`** — Tägliche Frage-Auswahl pro Curriculum
   - `day`, `curriculum_id`, `exam_question_id`, `blueprint_id`, `trap_type`, `slug`, `social_caption`, `explanation_md`, `status`
2. **`trap_content_pages`** — Automatisierte Fehler-Content-Seiten
   - `curriculum_id`, `competency_id`, `trap_type`, `slug`, `title`, `hook`, `content_md`, `social_caption`, `status`
3. **`growth_content_queue`** — Unified Content-Queue für alle Kanäle
   - `channel` (question_of_day | trap_content | video_script | carousel | blog), `source_type`, `source_id`, `platform`, `status`, `scheduled_at`, `content_json`, `posted_at`

### Neue RPC-Funktionen
- `fn_pick_daily_question(p_curriculum_id)` — Deterministisch beste Frage wählen (hohe Trap-Coverage, nicht kürzlich gezeigt)
- `fn_get_readiness_score(p_user_id, p_curriculum_id)` — Bestehens-Wahrscheinlichkeit berechnen

### Cron-Job
- `cron_daily_growth_content` — Täglich 06:00 → pick question + generate content

## Phase 2: Edge Functions

1. **`generate-daily-question`** — Wählt Frage, generiert Erklärung + Social Captions via LLM
2. **`generate-trap-content`** — Generiert Fehler-Content aus trap_type SSOT
3. **`calculate-pass-probability`** — Bestehens-Rechner Logik (mastery + sessions → Score)

## Phase 3: Public SEO-Seiten (Frontend)

1. **`/frage-des-tages`** — Aktuelle Frage mit Antworten, Lösung, Trap-Erklärung, Social Sharing
2. **`/frage-des-tages/[slug]`** — Archiv-Seite mit OG-Tags, JSON-LD
3. **`/pruefungsfehler/[beruf]/[kompetenz]`** — Trap-Content-Seiten
4. **`/bestehen-ich-die-ihk-pruefung`** — Interaktiver Bestehens-Rechner (öffentlich, Lead-Capture)

## Phase 4: Admin UI Erweiterung

GrowthSeoCommandCenter erweitern um:
- **Content Pipeline Tab** — Queue-Übersicht aller Kanäle, Status, Scheduling
- **Frage des Tages Tab** — Aktuelle/geplante Picks, Override-Möglichkeit
- **Trap Content Tab** — Coverage-Matrix (welche trap_types abgedeckt, Lücken)
- **Distribution Tab** — Posting-Status pro Kanal, Engagement-Metriken (später)

## Phase 5: Social Distribution (Vorbereitung)

- Content-Templates für LinkedIn, Instagram, TikTok (JSON-Struktur)
- Posting-Queue mit `scheduled_at` für spätere API-Anbindung
- Webhook-Endpoints für n8n/Make.com Fallback

## Reihenfolge
1. Migration (Tabellen + RPCs) → User Approval
2. Edge Functions parallel bauen
3. Public Pages parallel bauen  
4. Admin UI erweitern
5. Cron-Job aktivieren
