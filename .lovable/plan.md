## Ausgangslage

Customer Reality Gate: **BLOCK, Score 4/12, 47 P0-Findings** aus diesem Run.
Guard verhält sich korrekt — der Block ist Realität, nicht Artefakt. Vier Cluster, in dieser Reihenfolge zu fixen, weil sie aufeinander aufbauen:

```text
P0.1 Domain-Drift   →   P0.2 Cold-Load   →   P0.3 Dashboard-CTA   →   P0.4 MiniCheck/Tutor/Oral
(Mess-Hygiene)         (Public-Funnel)      (Logged-In Funnel)        (Lern-Surfaces)
```

Reihenfolge ist nicht verhandelbar: solange P0.1 nicht sitzt, mischt der Gate Preview- und Prod-Findings und P0.2–P0.4 sind nicht sauber messbar.

---

## P0.1 — Domain-/Base-URL-Drift entfernen  *(Mess-Hygiene)*

**Symptom**: Gate-Run gegen `examfitde.lovable.app`, Findings landen auf `https://berufos.com/...`.

**Ursachenkandidaten** (zu verifizieren):
1. Prod-Redirect `examfitde.lovable.app → berufos.com` (HTTP 301) zieht jeden Cold-Load auf die Authority.
2. Build mit `VITE_FORCE_AUTHORITY_CTAS=true` rendert absolute `https://berufos.com/...` Hrefs in SafeCta + Pre-Hydration-Anchors in `index.html`.
3. Hartverdrahtete `https://berufos.com/...` Hrefs in einzelnen Pages (Verticals/Suites/Hub).

**Fix (deterministisch)**:
- Parity-Guard ist bereits auf `berufos.com` als Test-Base gepinnt → wir **testen nur noch gegen Prod-Authority**. Damit ist „Mischung" strukturell ausgeschlossen.
- Build-Flag `VITE_FORCE_AUTHORITY_CTAS` aus CI entfernen, falls gesetzt — Authority-Force soll nur Notbremse sein, kein Default.
- Grep über `https://berufos.com` außerhalb von `seo/`-Canonicals: jeden Treffer auf relative SPA-Routen umstellen (außer `share-utils`, Open-Graph, JSON-LD).

**Done-Kriterium**: Reality-Run gegen `berufos.com` produziert **0 Findings mit Host-Mismatch**. `findings/*.json` Detail-String enthält nie einen Host, der nicht gleich `BASE_URL` ist.

---

## P0.2 — Public-Routen cold-load-fähig  *(Public-Funnel)*

**Symptome** (aus Run): `P02_find_beruf links=0`, `P03_open_course url=NONE`, `P04_pricing hasPrice=false`, `P05_cta_click no-course`. Mehrere `/berufe/<slug>` mit Body=0 chars.

**Routen, die ohne JS-Hydration sichtbaren Inhalt liefern müssen**:
- `/berufe` → Berufsliste mit ≥3 Links auf `/berufe/:slug` im initialen HTML.
- `/berufe/:slug` → Berufstitel + Conversion-CTA im SSR/Prerender-Output.
- `/preise` → mindestens ein `€`-Wert + Kauf-CTA im initialen HTML.

**Fix-Pfade**:
- Prerender-Pipeline (Vercel) muss diese Routen erzeugen. Sitemap-Audit: liefern `/berufe`, `/berufe/:slug`, `/preise` per-route HTML statt SPA-Shell? `scripts/seo/verify-authority-live.mjs` als Probe-Vorlage nutzen.
- `PreisePage` rendert Preise heute hinter Data-Loader → Pricing-SSOT statisch in den ersten Paint ziehen (Compile-time Konstanten aus `src/config/verticalPricing.ts`).
- `BerufOSHub` / Verticals-Hub: Liste der Berufe statisch in den initialen Paint (kein async fetch im Render-Path) — bestehende `src/content/seoRoutes.ts` als SSOT verwenden.

**Done-Kriterium**: `cold-load-verify.mjs` erweitert um `/berufe`, `/berufe/:slug` (mind. 1 Sample), `/preise`. Alle 4 Specs `P02–P05` grün im Reality-Run.

---

## P0.3 — Dashboard Next-Step-CTA  *(Logged-In Funnel)*

**Symptom**: `/dashboard` ohne sichtbaren Primary-CTA. Onboarding bricht mit „no next-step cta" ab.

**Fix**:
- In `src/pages/LearnerDashboard.tsx` einen deterministischen **Next-Step-Resolver** ergänzen, der genau eine sichtbare `SafeCta data-testid="dashboard-next-step"` rendert mit fester Hierarchie:
  1. Aktiver Kurs + offene Lektion → „Weiter lernen"
  2. Kein Fortschritt, MiniCheck verfügbar → „MiniCheck starten"
  3. Kein Kurs aktiv → „Kurs öffnen" (auf `/berufe`)
  4. Fallback (kein State) → „Prüfung simulieren"
- Resolver darf nie `null` zurückgeben → garantiert sichtbarer CTA, auch in leerem State.
- Unit-Test `LearnerDashboard.next-step.test.tsx`: 4 State-Permutationen, jeweils ein sichtbarer CTA mit erwartetem `to`.

**Done-Kriterium**: Reality-Learner-Spec `04-onboarding` grün, `data-testid="dashboard-next-step"` immer im DOM.

---

## P0.4 — MiniCheck / Tutor / Oral Surface  *(Lern-Surfaces)*

**Symptome**: MiniCheck `no question reached`, Tutor `no input`, `/muendliche-pruefung` White Screen.

**Fix-Pfade**:
- **MiniCheck**: Entry-Component muss synchron mind. einen Fallback-Frame mit Frage 1 oder explizitem „Keine Frage verfügbar — zurück zum Kurs"-CTA rendern statt Spinner-Loop. Loader-Timeout (5s) → Recovery-Surface mit Link zurück.
- **AI Tutor**: `TutorEntryPage` muss `<textarea data-testid="tutor-input">` schon vor Backend-Bootstrap rendern (Input darf nicht hinter Auth-Check verschwinden — disabled-State mit Hint statt unmount).
- **Oral Exam** (`OralExamTrainer.tsx`): White-Screen-Ursache wahrscheinlich Error-Boundary-Schluck oder fehlender Top-Level-Fallback. Error-Boundary + immer-sichtbares Heading „Mündliche Prüfung" + Mic-Permission-CTA als Skeleton im ersten Paint.

**Done-Kriterium**: Learner-Specs `05-learning` (MiniCheck), `07-ai-tutor`, `09-oral-exam` grün. Cold-Load-Verify zeigt für jede der drei Routen Body > 1 KB sichtbaren Text.

---

## Abnahmekette (sequenziell)

1. P0.1 implementieren → Reality-Gate lokal/Nightly laufen lassen → Hostnamen aller Findings ≡ Base-URL. **STOP hier zur Abnahme.**
2. P0.2 implementieren → Cold-Load-Verify erweitern → P02–P05 grün. **STOP.**
3. P0.3 implementieren → Learner-Onboarding grün. **STOP.**
4. P0.4 implementieren → MiniCheck/Tutor/Oral grün → Gate-Verdict ≥ `REVIEW_REQUIRED` (Ziel `PASS ≥ 10/12`).

Jeder STOP ist ein expliziter Commit + Reality-Run + dein Sign-off, bevor der nächste P0 startet. Kein „big bang" — Architecture-Freeze + Funnel-Freeze-Constraint bleibt respektiert.

## Was diese Sequenz NICHT anfasst

- Keine neuen Core-Komponenten (Agent-OS Freeze).
- Keine neuen Routen, Tabellen, Migrations — nur Render-Path-Fixes und CTA-Verdrahtung.
- Keine Test-Reduktion: alle bestehenden Specs bleiben aktiv und werden als Done-Kriterium genutzt.

**Bestätige die Reihenfolge oder priorisiere um — dann starte ich mit P0.1.**