# ExamFit Redesign — Phasenplan „Prüfungssystem statt Lernplattform"

Der Superprompt deckt Hero, Bundle, Mockups, Card-System, Mobile-Header, Copy, CTA-Logik, SEO und drei Zielgruppen ab. Das ist umfangreich — wir liefern in drei klar abgegrenzten Phasen, damit jede Phase isoliert reviewbar und live gehbar ist.

## Vor Implementierung — bitte 4 Entscheidungen

1. **Reihenfolge** — Phase A (Startseite + Mockups) ODER Phase B (Bundle-Seite zuerst) ODER C (alles parallel)? Empfehlung: **A**, weil sichtbarster Impact und Bundle-Seite davon profitiert.
2. **Mockup-Tiefe** — statische Demo-Komponenten (½ Tag) oder echte Live-Previews aus Demo-Kurs (mehrere Tage)? Empfehlung: **statisch**, später optional verkabeln.
3. **„98 %-Claim"** — entfernen + durch „Prüfungsreife-Score" ersetzen, oder durch eigene belegbare Zahl ersetzen (dann Quelle bitte mitschicken)? Empfehlung: **entfernen**.
4. **CTA-Rollout** — neue Texte direkt als Default oder A/B über vorhandenes `cta_winner_decisions`-System (48 h Auto-Promote)? Empfehlung: **direkt als Default** für Hero-CTA, A/B nur für Sub-CTAs.

Antwort als kurze Liste reicht („A, statisch, entfernen, direkt"). Danach starte ich Phase A direkt.

## Phase A — Startseite + Produkt-Mockups (1 Sprint)

### Hero-Section umbauen (`src/pages/Index.tsx` bzw. `src/components/landing/Hero.tsx`)
- Headline: „Finde in 4 Minuten heraus, wie prüfungsreif du bist."
- Subline: „ExamFit analysiert deine Schwächen, erstellt deinen Lernplan und trainiert dich mit Lernkurs, Prüfungsfragen, KI-Tutor und mündlicher Simulation bis zur Abschlussprüfung."
- Primary CTA: „Kostenlos Prüfungsreife testen" → führt zu Lead-Quiz
- Secondary CTA: „Komplett-Bundle ansehen" → /produkt/komplett
- Trust-Zeile: „Kein Abo · 12 Monate Zugang · Prüfungstraining nach Rahmenplan"
- 98 %-Claim entfernen

### Neue Sektion „So funktioniert ExamFit" (4 Schritte, neue Komponente `HowItWorksSection`)
- Schritt 1: Prüfungsreife testen
- Schritt 2: Schwächen erkennen
- Schritt 3: Gezielt trainieren
- Schritt 4: Prüfung simulieren
- Visuell: nummerierte Cards mit Mini-Icons, kein generisches Stockfoto

### Produkt-Mockup-Galerie (neue Komponente `ProductPreviewGallery`)
Statische, designsystem-konforme Mock-Cards:
- `ReadinessScoreMock` — Donut + „72 % prüfungsreif"
- `CompetencyMasteryMock` — 3 Balken (Warenwirtschaft partial, Kundenkommunikation mastered, …)
- `ExamQuestionMock` — Frage + 4 Antwortoptionen mit korrekt/falsch-Markierung
- `AiTutorFeedbackMock` — Antwort mit `[Quelle: §14 BBiG]`-Citation-Block
- `OralExamFeedbackMock` — 4 Bewertungsachsen (Fachlichkeit/Struktur/Begriffssicherheit/Praxisbezug)

Alle Mockups in `src/components/landing/mockups/`, dunkles Design-System v2 Tokens, Petrol/Mint, keine `text-white`-Hardcodes.

### Card-Verdichtung (bestehende Sections)
- Padding mobile 20–24 px (Tokenisierung über `card-density`-Variante)
- Headlines max. 2 Zeilen (CSS clamp + line-clamp), Body max. 3 Zeilen
- Repetitive Marketing-Cards entfernen, durch konkrete Ergebnis-Versprechen ersetzen („Du weißt, welche Themen dich Punkte kosten")

### Mobile Sticky-Header-Fix
- z-index sauber, `pt-[env(safe-area-inset-top)]`
- Sticky-CTA-Bar erscheint nur, wenn Hero-CTA aus Viewport gescrollt → IntersectionObserver
- Top-Padding der ersten Section gegen Header-Overlap

### Tracking
- `landing_view`-Mirror ist bereits gefixt (vorheriger Sprint)
- Hero-CTA: bestehender `cta_clicked` mit `cta_location='hero_primary'` + neue Variante registrieren
- Quiz-CTA: bestehender `quiz_started`-Pfad bleibt unverändert

## Phase B — Bundle-Seite (`/produkt/komplett`, 1 Sprint)

Neue Struktur in `src/pages/landing/DynamicProductLandingPage.tsx` bzw. dedizierter Bundle-Komponente:
- Hero mit Preis (24,90 €) + Nutzenversprechen
- Module-Liste (was ist drin)
- Ergebnisversprechen (4 Outcomes)
- Vergleichstabelle „Einzeln lernen vs. ExamFit-System"
- FAQ mit `schema.org/FAQPage` JSON-LD
- Finaler Sticky-CTA „Bundle starten – 24,90 €"

CTA-Tracking: `checkout_started` mit `package_id` aus Bundle-Resolver (bereits SSOT-verkabelt).

## Phase C — Berufsseiten + SEO + Persona-Branches (1 Sprint)

- Persona-spezifische CTA-Logik (Azubi/Betrieb/Institution) — `ProductPersonaPage` ist da, CTAs schärfen
- Pro Berufsseite: einzigartige H1, FAQ mit Berufsnennung, interne Links zu Bundle/Trainer/Lernplan
- `Product`-JSON-LD pro Bundle bereits vorhanden, FAQ-JSON-LD neu
- Duplicate-Copy-Guard: bestehender `prerender.mjs` plus neuer Variablen-Check (Beruf-Token in jeder Section)

## Technische Leitplanken (gilt für alle Phasen)

- **Design-System v2 Tokens** — keine `text-white`/`bg-X/10` Hardcodes. Petrol/Mint Identität.
- **Mobile-First** — alles wird im 411×763-Viewport zuerst entworfen, dann skaliert.
- **Komponentenbasiert** — neue Marketing-Komponenten unter `src/components/landing/`, kein Inline-JSX in Pages.
- **Tracking unverändert** — Event-Namen + `package_id`/`persona`/`source_page` Pflichtfelder strikt einhalten (SSOT-Smoke läuft im CI).
- **SEO** — H1/canonical/meta-description bleibt SSOT in `src/lib/seo/*`. Keine doppelten H1.
- **Kein Backend-Touch** in Phase A/B. Phase C kann optional eine kleine `bundle_outcomes`-Tabelle bekommen, falls wir Outcomes datengetrieben pro Beruf zeigen wollen — kläre ich erst in C.

## Was nicht im Scope ist

- Echte Live-Daten in Mockups (separater Sprint, falls gewünscht)
- Bestehensquoten-Studie (braucht externe Datenbasis)
- Komplett neue Design-Tokens (wir nutzen v2)
- B2B-Signup-Flow (eigenes Feature)

## Lieferreihenfolge (Default-Empfehlung)

1. Phase A → Live → 48 h beobachten via vorhandene Funnel-KPIs (`landing_view`, `cta_clicked`, `quiz_started`)
2. Phase B → Live → A/B Bundle-Hero-Copy via vorhandenes Auto-Promote
3. Phase C → Berufsseiten + Persona-Schärfung
