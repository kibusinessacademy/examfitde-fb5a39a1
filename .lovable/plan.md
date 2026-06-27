## EXAMFIT.DESIGN.SYSTEM.OS.1 — Plan

Ziel: Aus den HeyGen-Prinzipien (Hero-Gradients, große Karten, Bild-First, Glas/Chips, weiche Schatten) eine **eigene** ExamFit-Designsprache machen — ruhig, prüfungsnah, motivierend, ohne Kinderlern-Optik. Aufbauend auf Welle C (`LearnLessonCard`) und LIF.OS.1, **nicht** als Reset.

Lieferung in 4 Wellen, jede für sich abgeschlossen und PR-fähig. Wave 1 ist Pflicht-Foundation; Wave 2–4 bauen darauf auf und können einzeln gestoppt werden.

---

### Wave 1 — Foundation Tokens & Primitives (P0, ein PR)

Pure-SSOT, keine sichtbare Seitenänderung außer der neuen `/design/examfit-ds` Demo-Seite.

1. **Token-Erweiterung in `index.css` + `tailwind.config.ts`**
   - Bereichs-Gradients als CSS-Variablen:
     `--surface-hero-learn` (Türkis→Blau→Grün), `--surface-hero-exam` (Blau→Türkis), `--surface-hero-tutor` (Grün→Petrol), `--surface-hero-oral` (Orange→Rot), `--surface-hero-shop` (Violett→Blau). Light + Dark.
   - Radius-Skala: `--radius-card-sm: 16px`, `--radius-card: 20px`, `--radius-card-lg: 24px`, `--radius-card-xl: 28px`.
   - Shadow-Skala: `--shadow-card`, `--shadow-card-hover`, `--shadow-hero` (sehr weich, dezent).
   - Glass-Tokens: `--glass-bg`, `--glass-border`, `--glass-blur` (nur `filter:`, kein `backdrop-filter` als Pflicht — siehe Guard).
   - Erweiterung Tailwind: `rounded-card / card-lg / card-xl`, `shadow-card / shadow-card-hover / shadow-hero`, `bg-hero-learn / -exam / -tutor / -oral / -shop`.

2. **Primitive-Komponenten** unter `src/components/examfit-ds/`
   - `<HeroSurface area="learn|exam|tutor|oral|shop" />` — Verlaufsfläche + optionaler Parallax-Slot, sehr dezente Frame-basierte Bewegung.
   - `<ImageCard />` — große Bildkarte (Bild, Titel, Eyebrow, optional Chip-Reihe, Hover-Lift).
   - `<FloatingChip variant="exam|course|tutor|oral|fav|time|ihk" />` — Pill mit Icon-Slot.
   - `<GlassPanel />` — leichter Frost-Container (über `filter: blur()`, nicht `backdrop-filter`).
   - `<ProgressMeter shape="bar|dots|ring" value=... total=...>` — vereinheitlicht die heute uneinheitlichen Progress-Anzeigen.

3. **Erweiterung `<LearnLessonCard />`**
   - Neue Props (additiv, keine Breaking Changes): `area` (für Hero-Gradient-Eyebrow), `image` (optionales Hero-Bild oben), `tone="calm|focused|exam"` (steuert Padding/Akzent).
   - Default-Look bleibt unverändert — bestehende Tests + Migrationen brechen nicht.

4. **Guards / Tests**
   - Vitest-Snapshot pro Primitive.
   - CI-Guard (`scripts/guard-no-raw-hex.mjs` erweitern): keine Hex-Werte in `src/components/examfit-ds/**`; nur Tokens.
   - CI-Guard: `backdrop-filter:` nur in einer Allowlist (sandbox/render-safe).
   - `src/pages/design/ExamFitDesignSystemDemo.tsx` (admin-only Route `/admin/design/examfit-ds`) zeigt alle Primitives lebendig — als Reality-Check.

---

### Wave 2 — Lesson Hero & Kompetenz-Bilder (P1)

5. **Lesson Hero** im LessonPlayer
   - Oberer Bereich jeder Lektion wird zur `<HeroSurface area="learn">` mit: Eyebrow „Schritt X von Y · Modus", H1 (Kompetenztitel), `<ProgressMeter shape="bar">` mit Prozent.
   - Komplett über bestehende Felder gespeist — keine Schema-Änderung.

6. **Kompetenz-Bilder** (read-only Reuse)
   - Wiederverwendung der bestehenden Beruf/Keyword-Bildpipeline (`generate-beruf-image`, `useBerufImages`) auf Kompetenzebene; **kein** neuer Generator, kein neuer Cache. Mapping über bereits existierende Keyword-Felder.
   - Fallback: gradient-only Hero, wenn kein Bild verfügbar (kein Layout-Shift).

7. **Tests**: Snapshot LessonPlayer-Hero, Fallback-Pfad ohne Bild.

---

### Wave 3 — Learning Dashboard & Karten-Migration (P1)

8. **Dashboard-Karten** auf `<ImageCard />` umstellen
   - „Lernkurs · Prüfung · KI-Tutor · Mündliche Prüfung · Fortschritt · Schwächen" als 2-Spalten-Grid (mobile-first).
   - Bestehende Daten-Hooks bleiben — nur Präsentation.

9. **Floating-Chip-Pass** auf Kursdetail-/Berufsseiten
   - Ersetzt heutige inkonsistente Badge-Reihen durch `<FloatingChip />`.
   - Visual-only.

10. **Tests**: Render-Tests, Chip-Reihenfolge stabil, Accessibility-Labels.

---

### Wave 4 — Motion-Feedback (P2, optional)

11. **Sehr dezente Lernmomente** (alle hinter `prefers-reduced-motion`):
    - Progress-Bar fließt (220 ms, ease-out).
    - Richtige Antwort → einmaliger grüner Glow am Card-Border (status-done).
    - Falsche Antwort → 80 ms Shake.
    - Kompetenz abgeschlossen → minimaler Konfetti-Sprite (ein einzelner Burst, kein Dauerloop).
12. Keine Animation in Tutor/Streaming-Flows, keine Hover-Glows auf der ganzen Seite — nur an definierten Lernmomenten.

---

### Hart NICHT in diesem System

- Keine neue Input-/Antwortkomponente (LIF.OS.1 bleibt einzige Quelle).
- Keine Curriculum-/Blueprint-/Unlock-Logik-Änderung.
- Keine Paywall-/Pricing-Änderung.
- Keine `backdrop-filter`-Pflicht (Render-Sicherheit).
- Keine Hex-Farben in `examfit-ds/**`.
- Keine zweite Card-Familie neben `LearnLessonCard` für Lernschritte — Visual-Cards (`ImageCard`) sind für Navigation/Übersicht, **nicht** für Lernschritte.

---

### Reihenfolge & Entscheidungspunkte

Standardvorschlag: **Wave 1 jetzt komplett bauen** (Tokens + Primitives + Demo + Guards). Danach kurzes Review der Demo-Seite, dann Wave 2 → 3 → 4 nacheinander mit jeweils eigener Freigabe.

### Offene Entscheidungen vor Wave 1

1. **Gradient-Charakter**: ruhig-dezent (deine Cut-3-Linie „professioneller Prüfungstrainer, nicht Kinder-App") oder etwas plakativer wie HeyGen? Vorschlag: dezent — Sättigung ~60 %, kein Neon.
2. **Scope Wave 1**: nur Tokens + Primitives + Demo-Seite, **ohne** echte Seitenänderung — bestätigt?
3. **Bilder Kompetenz-Ebene (Wave 2)**: Reuse vorhandener Pipeline ok? (keine neuen Edge-Functions, kein neues Storage-Bucket)
