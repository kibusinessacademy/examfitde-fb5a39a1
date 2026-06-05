# Customer Reality Gate — BLOCK

**Score:** 1 / 12  ·  **P0 findings:** 42  ·  **Rule:** Any P0 finding → BLOCK · sonst PASS>=10/12 → RELEASE · 8..9 → REVIEW · <8 → BLOCK

| # | Journey | Source | Status | Detail |
|---|---------|--------|--------|--------|
| 1 | Homepage | pre | ❌ fail | problems=1 |
| 2 | Beruf finden | pre | ❌ fail | links=0 |
| 3 | Beruf öffnen | pre | ❌ fail | ttc=696ms url=NONE |
| 4 | Preise | pre | ❌ fail | hasPrice=false |
| 5 | CTA | pre | ❌ fail | no-course |
| 6 | Registrierung | learner | ⚠️ missing | no result file |
| 7 | Login | flag | ✅ pass | login flag present |
| 8 | Onboarding | learner | ⚠️ missing | no result file |
| 9 | MiniCheck | learner | ⚠️ missing | no result file |
| 10 | AI Tutor | learner | ⚠️ missing | no result file |
| 11 | Prüfungssimulation | learner | ⚠️ missing | no result file |
| 12 | Rückkehr | learner | ⚠️ missing | no result file |

## 🚨 P0 Findings (Hard-BLOCK)

1. **broken_route** — `/preise`
   - Public route /preise returned status 200 / empty body.
   - _Fix:_ Route reparieren oder Navigation entfernen.
2. **broken_route** — `/berufe`
   - Public route /berufe returned status 200 / empty body.
   - _Fix:_ Route reparieren oder Navigation entfernen.
3. **dead_cta** — `/`
   - Kein primärer CTA im sichtbaren Bereich der Homepage.
   - _Fix:_ Hero-CTA prüfen / cookie banner darf CTA nicht verdecken.
4. **demo_unreachable** — `/berufe`
   - Kein Produkt-Einstiegspunkt erreichbar.
   - _Fix:_ Produktkatalog reparieren.
5. **dead_cta** — `/dashboard`
   - Kein next-step CTA im Dashboard sichtbar.
   - _Fix:_ Primary-Next-Action im Dashboard.
6. **white_screen** — `https://berufos.com/muendliche-pruefung`
   - Oral-Oberfläche leer.
   - _Fix:_ Renderer / Datenpfad prüfen.
7. **dead_cta** — `/`
   - Kein primärer CTA above the fold.
   - _Fix:_ Hero-CTA sichtbar machen, Cookie-Banner darf CTA nicht verdecken.
8. **broken_route** — `/berufe`
   - Nur 0 Beruf-Links sichtbar — Visitor kann keinen Beruf finden.
   - _Fix:_ Berufs-Liste hydratisieren / SSR-Fallback prüfen.
9. **broken_route** — `?`
   - Visitor erreicht keine Kurs-/Produktseite ab Homepage.
   - _Fix:_ Berufe-Hub muss klickbare Karten mit echten Detail-Routen liefern.
10. **workflow_no_feedback** — `/preise`
   - Pricing-Seite zeigt keinen €/EUR-Preis.
   - _Fix:_ Pricing-SSOT auf /preise rendern (statt nur auf Produktseiten).
11. **dead_cta** — `/preise`
   - Pricing-Seite hat keinen sichtbaren Kauf-CTA.
   - _Fix:_ Primary-CTA pro Pricing-Tier hinzufügen.
12. **dead_cta** — `?`
   - Konnte keine Kursseite öffnen für CTA-Test.
   - _Fix:_ Erst P03 (Discovery) fixen.
13. **checkout_unreachable** — `?`
   - Konnte keine Kursseite öffnen — Checkout-Surface untestbar.
   - _Fix:_ P03 fixen.
14. **broken_route** — `/berufe`
   - Cold-load body too short (76 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
15. **broken_route** — `/berufe/einzelhandelskaufmann-frau`
   - Cold-load body too short (76 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
16. **broken_route** — `/berufe/kaufmann-frau-bueromanagement`
   - Cold-load body too short (76 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
17. **broken_route** — `/berufe/fachinformatiker-systemintegration`
   - Cold-load body too short (76 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
18. **broken_route** — `/berufe/kfz-mechatroniker-in`
   - Cold-load body too short (76 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
19. **broken_route** — `/berufe/bankkaufmann-frau`
   - Cold-load body too short (76 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
20. **broken_route** — `/berufe/fachkraft-fuer-lagerlogistik`
   - Cold-load body too short (76 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
21. **broken_route** — `/berufe/chemielaborant-in`
   - Cold-load body too short (76 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
22. **dead_cta** — `/`
   - Kein primärer CTA above the fold.
   - _Fix:_ Hero-CTA sichtbar machen, Cookie-Banner darf CTA nicht verdecken.
23. **broken_route** — `/berufe`
   - Nur 0 Beruf-Links sichtbar — Visitor kann keinen Beruf finden.
   - _Fix:_ Berufs-Liste hydratisieren / SSR-Fallback prüfen.
24. **broken_route** — `?`
   - Visitor erreicht keine Kurs-/Produktseite ab Homepage.
   - _Fix:_ Berufe-Hub muss klickbare Karten mit echten Detail-Routen liefern.
25. **workflow_no_feedback** — `/preise`
   - Pricing-Seite zeigt keinen €/EUR-Preis.
   - _Fix:_ Pricing-SSOT auf /preise rendern (statt nur auf Produktseiten).
26. **dead_cta** — `?`
   - Konnte keine Kursseite öffnen für CTA-Test.
   - _Fix:_ Erst P03 (Discovery) fixen.
27. **checkout_unreachable** — `?`
   - Konnte keine Kursseite öffnen — Checkout-Surface untestbar.
   - _Fix:_ P03 fixen.
28. **broken_route** — `?`
   - Mobile-Discovery erreicht keine Kursseite ab Homepage.
   - _Fix:_ Berufe-Hub-Karten müssen auf 390px tappable sein (min 44px Höhe).
29. **broken_route** — `/berufe`
   - Cold-load body too short (0 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
30. **broken_route** — `/berufe/einzelhandelskaufmann-frau`
   - Cold-load body too short (0 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
31. **broken_route** — `/berufe/kaufmann-frau-bueromanagement`
   - Cold-load body too short (0 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
32. **broken_route** — `/berufe/fachinformatiker-systemintegration`
   - Cold-load body too short (0 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
33. **broken_route** — `/berufe/kfz-mechatroniker-in`
   - Cold-load body too short (0 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
34. **broken_route** — `/berufe/bankkaufmann-frau`
   - Cold-load body too short (0 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
35. **broken_route** — `/berufe/fachkraft-fuer-lagerlogistik`
   - Cold-load body too short (0 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
36. **broken_route** — `/berufe/chemielaborant-in`
   - Cold-load body too short (0 chars).
   - _Fix:_ SSR / static fallback für Route sicherstellen.
37. **dead_cta** — `/`
   - Kein primärer CTA above the fold.
   - _Fix:_ Hero-CTA sichtbar machen, Cookie-Banner darf CTA nicht verdecken.
38. **broken_route** — `/berufe`
   - Nur 0 Beruf-Links sichtbar — Visitor kann keinen Beruf finden.
   - _Fix:_ Berufs-Liste hydratisieren / SSR-Fallback prüfen.
39. **broken_route** — `?`
   - Visitor erreicht keine Kurs-/Produktseite ab Homepage.
   - _Fix:_ Berufe-Hub muss klickbare Karten mit echten Detail-Routen liefern.
40. **workflow_no_feedback** — `/preise`
   - Pricing-Seite zeigt keinen €/EUR-Preis.
   - _Fix:_ Pricing-SSOT auf /preise rendern (statt nur auf Produktseiten).
41. **dead_cta** — `/preise`
   - Pricing-Seite hat keinen sichtbaren Kauf-CTA.
   - _Fix:_ Primary-CTA pro Pricing-Tier hinzufügen.
42. **dead_cta** — `?`
   - Konnte keine Kursseite öffnen für CTA-Test.
   - _Fix:_ Erst P03 (Discovery) fixen.

_Bridge over learner-reality + pre-customer-reality aggregators. No fork._
