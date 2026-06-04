# Pre-Customer Local Run (E2E_TARGET=production → https://berufos.com)
Date: 2026-06-04T21:06Z · Specs: P01..P05 · Login: skipped

| # | Spec | Result | Detail |
|---|------|--------|--------|
| P01 | Homepage | ❌ fail | problems=1 (Primary CTA / hero-CTA post-hydration nicht erkannt) |
| P02 | /berufe | ❌ fail | links=0 (post-hydration keine Beruf-Links sichtbar) |
| P03 | Open course | ❌ fail | ttc=696ms url=NONE (Discovery liefert keine Kurs-URL) |
| P04 | /preise | ❌ fail | hasPrice=false (€/EUR im Body nicht gefunden) |
| P05 | CTA click | ❌ fail | no-course (Folgefehler aus P03) |

## Diagnose
- Cold-Load HTML (`curl https://berufos.com/preise`) enthält `data-prehydration` + `24,90 €` → Prehydration deployt.
- Post-Hydration Body (Playwright) zeigt KEIN €-Zeichen → React-Komponente `/preise` überschreibt Prehydration mit leerem/anderem State.
- Drift-Klasse: **Hydration-Drift**, nicht Deploy-Drift. P0.2 Prehydration wirkt nur für reine HTML-Crawler/Cold-Load, nicht für echte Browser-Sessions nach React-Mount.
- P02/P03 vermutlich gleicher Mechanismus: SSR-Fallback OK, aber React-Hub rendert Liste leer.

## Empfehlung (vor GitHub-Gate)
Nur echte Regressions, keine neue Architektur:
1. `/preise` React-Komponente: sichtbarer 24,90 € + Kauf-CTA als Default-Render (nicht hinter Loading-State).
2. `/berufe` Hub: SSR-Fallback-Liste auch nach Hydration anzeigen, wenn Query leer/loading.
3. Homepage Hero: „Prüfung starten"-CTA als sichtbares <a> nach Hydration sicherstellen (nicht hinter Splash).

Learner-Journeys nicht lokal getestet (Login/Testdaten via CI).
