
# Witz des Tages – Umsetzungsplan

## Status Quo
- `humor_items`-Tabelle existiert, enthält aber nur ~4 Einträge für eine einzige Zertifizierung
- Edge Function `get-daily-humor` wählt täglich einen Witz aus dem Pool
- `DailyHumorCard` zeigt den Witz im Learner Dashboard
- **Problem**: Kein Pipeline-basierter Generierungsprozess, kein Social Sharing

---

## Phase 1: Pipeline-basierte Humor-Generierung

### 1.1 Neuer Pipeline-Step: `generate_humor`
- Neuer Step in der Content-Pipeline pro Paket/Zertifizierung
- Generiert **20–30 berufsspezifische Witze/Sprüche** pro Kurs
- LLM-Prompt nutzt Persona-Profil (AZUBI, SACHKUNDE, FACHWIRT, STUDIUM) für Tonalität
- Input: Curriculum-Kontext, Fachbegriffe, typische Prüfungssituationen
- Output: humor_items mit `certification_id`, `competence_id`, `humor_type`, `tone`

### 1.2 Validierung & Safety
- AI-Validierung auf Safety-Score (kein Rassismus, Sexismus, politische Witze)
- `safety_score >= 0.8` als Gate
- Ton-Kategorien: `casual` (Azubis), `business` (Fachwirt/Sachkunde), `academic` (Studium)
- Quality-Gate analog zu anderen Pipeline-Artefakten

### 1.3 Rotation & Freshness
- `valid_from` / `valid_to` für saisonale Witze (Prüfungsphase-Humor)
- `shown_count` + `last_shown_at` für faire Rotation (existiert bereits)
- Mindestpool: 20 Witze pro Zertifizierung bevor Feature aktiv wird

---

## Phase 2: Social-Media-Sharing

### 2.1 Share-Card-Generierung
- Generierte **OG-Image-Karte** pro Witz (1080×1080 für Instagram, 1200×630 für LinkedIn/FB)
- Design: ExamFit-Branding (Logo, Farben, Gradient-Background)
- Text: Witz-Text + Berufsbezug + ExamFit-Logo + URL
- Edge Function `generate-humor-share-card` erstellt das Bild on-demand
- Caching in Storage-Bucket `humor-share-cards`

### 2.2 Share-Endpunkt & Landing
- Öffentliche URL: `/witz/{humorId}` (SEO-fähig, kein Auth nötig)
- Zeigt: Witz + CTA zum Prüfungstraining + OG-Tags für Social Preview
- JSON-LD: `CreativeWork` mit `educationalLevel`
- Canonical URL für jeden Witz

### 2.3 Share-Buttons in DailyHumorCard
Plattformen mit nativen Share-Links:
- **Instagram**: Deep-Link zur Story (mit Share-Card als Bild)
- **TikTok**: Text-Copy + Link (kein direkter Share-API)
- **LinkedIn**: `https://www.linkedin.com/sharing/share-offsite/?url=...`
- **Facebook**: `https://www.facebook.com/sharer/sharer.php?u=...`
- **X/Twitter**: `https://twitter.com/intent/tweet?text=...&url=...`
- **Pinterest**: `https://pinterest.com/pin/create/button/?url=...&media=...&description=...`
- **WhatsApp**: `https://wa.me/?text=...`
- **Native Web Share API** als Fallback (mobile)

### 2.4 Branding & UTM
- Jeder Share-Link enthält: `?utm_source={platform}&utm_medium=social&utm_campaign=witz-des-tages`
- Share-Text-Template: `😂 {Witz} – Mehr Prüfungshumor auf ExamFit: {URL}`
- OG-Tags: `og:title`, `og:description`, `og:image`, `og:url`
- Twitter Card: `summary_large_image`

---

## Phase 3: Tracking & Optimierung

### 3.1 Share-Tracking
- Event `humor_shared` mit `{humor_id, platform, certification_id}`
- Aggregation in Dashboard: meistgeteilte Witze, beste Plattformen
- Feedback-Loop: hochbewertete + vielgeteilte Witze → mehr ähnliche generieren

### 3.2 Viralitäts-Metriken
- Klicks auf `/witz/{id}` tracken (UTM-basiert)
- Conversion: Witz-Besucher → Prüfungsreife-Check → Kauf
- A/B: Verschiedene Witz-Typen pro Persona testen

---

## Datenbank-Änderungen
- `humor_items`: Spalte `share_image_url` (text, nullable) hinzufügen
- `humor_items`: Spalte `share_count` (int, default 0) hinzufügen
- Neue Tabelle `humor_shares` (humor_id, user_id, platform, shared_at)
- Storage-Bucket `humor-share-cards` (public read)

## Neue Dateien
- `src/components/dashboard/HumorShareButtons.tsx` – Share-Button-Leiste
- `src/pages/seo/WitzPage.tsx` – Öffentliche Witz-Landingpage
- `supabase/functions/generate-humor-share-card/index.ts` – OG-Image-Generierung
- Pipeline-Integration in bestehenden Content-Build-Prozess

## Reihenfolge
1. DB-Migration (Spalten + Tabelle)
2. Pipeline-Step für Humor-Generierung (Batch pro Kurs)
3. Share-Card-Generierung (Edge Function)
4. Share-Buttons in DailyHumorCard
5. Öffentliche Witz-Seite mit OG-Tags
6. Tracking-Integration
