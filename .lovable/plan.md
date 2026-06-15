# Mehrsprachigkeits-Modul (i18n) — DE/EN/TR/AR/UK/RU

Ziel: Alle nicht-deutschsprachigen Nutzer können die komplette Plattform (UI) und sämtliche Kursinhalte (Lektionen, Fragen, Erklärungen, Mini-Checks) in ihrer Sprache nutzen. Arabisch inkl. RTL-Layout.

Wichtig: Wegen *Architecture Freeze* und *Market Activation Pivot* wird i18n als **EXTEND_ONLY**-Layer gebaut — keine Änderung an bestehenden SSOT-Tabellen/RPCs, sondern eine additive Translation-Schicht.

---

## 1. UI-Shell (Phase 1 — sofort lieferbar)

- `react-i18next` + `i18next-browser-languagedetector` einführen.
- Sprach-Provider in `src/main.tsx`, Fallback `de`.
- Globaler **LanguageSwitcher** im Top-Header (Globe-Icon + Dropdown, 5 Sprachen + Deutsch).
- Persistenz: `localStorage.lang` + `profiles.preferred_language` (sobald eingeloggt).
- `<html lang>` und `dir="rtl"` dynamisch für AR.
- Tailwind RTL-Utilities (`rtl:` Variants via `tailwindcss-rtl` Plugin oder Logical Properties).
- Translation-Files: `src/i18n/locales/{de,en,tr,ar,uk,ru}/common.json` — initial nur Navigation, Buttons, Auth, Pricing, Footer, Header.

## 2. Course-Translation-Layer (Phase 2 — pro-generiert)

Additive Tabellen (kein Eingriff in bestehende `courses`, `lessons`, `questions`):

```text
course_translations(course_id, lang, title, subtitle, description, updated_at, source_hash)
lesson_translations(lesson_id, lang, title, body_md, updated_at, source_hash)
question_translations(question_id, lang, stem, options_json, explanation, updated_at, source_hash)
translation_jobs(id, entity_type, entity_id, lang, status, attempts, error, created_at, completed_at)
```

- RLS: `SELECT` für `authenticated` + `anon` (öffentliche Kurs-Previews), `INSERT/UPDATE` nur `service_role`.
- GRANTs gemäß Lovable-Regel mitgeliefert.
- `source_hash` = sha256 der DE-Quelle → erkennt veraltete Übersetzungen automatisch.

**Translation-Worker (Edge Function `translate-content`)**:
- Triggert über Cron (alle 5 Min) + on-demand RPC `enqueue_translations(entity_type, entity_id)`.
- Nutzt **Lovable AI Gateway** (`google/gemini-2.5-flash` für Volumen, `gemini-2.5-pro` für Fachbegriffe).
- Strenger Prompt: Fachvokabular erhalten, Markdown-Struktur beibehalten, JSON-Strukturen valide.
- Idempotent über `source_hash`. Retry-Cap 3.

**Backfill**:
- Admin-Action `/admin/i18n` → "Alle Kurse für Sprache X queuen". Progress-Bar pro Sprache.

## 3. Client-Resolver

- Hook `useTranslatedCourse(courseId)` / `useTranslatedLesson(lessonId)` / `useTranslatedQuestion(qId)`:
  1. Liest `i18n.language`.
  2. Versucht `*_translations` Row; Fallback DE-Original wenn fehlt + zeigt dezenten Badge „Translation pending“.
  3. Triggert hintergründig `enqueue_translations` bei Fehlen.
- Alle Lesson-/Question-Renderer (`MiniCheck`, `LessonView`, `OralTrainer`-Prompts, `WrittenExam`) konsumieren den Resolver.

## 4. AI-Tutor & Oral-Exam

- Tutor-System-Prompt nimmt `target_language` aus Profil → antwortet in Nutzer-Sprache, behält Quellen-Zitate aber im Original.
- Oral-Exam Browser-STT/TTS: `lang`-Param dynamisch (`en-US`, `tr-TR`, `ar-SA`, `uk-UA`, `ru-RU`).

## 5. SEO / Routing

- Sprach-Präfix-Routen `/{lang}/...` für die 6 Sprachen (öffentliche Seiten); App-Bereich bleibt unter `/app/...` mit Header-Switch.
- `hreflang`-Tags pro Sprache + `sitemap-i18n.xml` Erweiterung.
- Bestehende Custom-Domain `berufos.com` behält DE als Default (kein 301-Bruch).

## 6. QA / Guards

- Playwright-Test `tests/e2e/i18n-shell.spec.ts`: Switcher rendert, `<html lang>` ändert sich, RTL für AR aktiv, Key-Strings übersetzt.
- Test `tests/e2e/i18n-course.spec.ts`: Lesson in EN lädt; Fallback-Badge erscheint wenn translation fehlt.
- ESLint-Regel `no-hardcoded-de-strings` (warn) für neue Komponenten in `src/components/landing|app`.

---

## Lieferreihenfolge

1. **PR-1 (heute):** i18n-Provider + Switcher + RTL + DE/EN `common.json` + `profiles.preferred_language` + Playwright Shell-Test.
2. **PR-2:** Übersetzungstabellen + Edge Function `translate-content` + Admin-Backfill-UI.
3. **PR-3:** Client-Resolver + Wiring in Lesson/Question/MiniCheck/Tutor.
4. **PR-4:** TR/AR/UK/RU `common.json` + Backfill aller existierenden Module + SEO `hreflang`.

---

## Offene Punkte (bitte bestätigen)

1. **Russisch ODER Ukrainisch** — oder beide separat? (Standardmäßig setze ich **beide** UK + RU.)
2. **Kosten-Budget Übersetzungen**: Backfill aller bestehenden Kurse × 5 Sprachen läuft über Lovable AI Gateway. Ich verwende `gemini-2.5-flash` (sehr günstig). OK?
3. **Sprach-Präfix-Routen** für öffentliche SEO-Seiten — ok, oder reicht reines Header-Switching (kein SEO-Boost dann)?

Sobald bestätigt, starte ich mit **PR-1**.
