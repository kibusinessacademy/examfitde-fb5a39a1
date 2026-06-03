# Pre-Customer Reality Daily QA — 2026-06-03

**Base URL:** https://examfitde.lovable.app
**Status:** **BLOCK**
**Customer Readiness Score:** **7 / 130**
**✅ TIME_TO_COURSE = 1.6s (Ziel ≤ 60s)**

## Journeys passed
- ✅ P11_seo_surface (7 pts)

## Journeys failed / missing
- ❌ P01_homepage (10 pts) — fail
- ❌ P02_find_beruf (15 pts) — fail
- ❌ P03_open_course (15 pts) — fail
- ❌ P04_pricing (15 pts) — fail
- ❌ P05_cta_click (10 pts) — fail
- ❌ P06_checkout_surface (15 pts) — fail
- ❌ P07_cross_sell (10 pts) — fail
- ❌ P08_berufos_hub (10 pts) — fail
- ❌ P09_trust_signals (8 pts) — fail
- ❌ P10_mobile_funnel (10 pts) — missing
- ❌ P12_legal_trust (5 pts) — fail

## Findings
**Counts:** P0=21 · P1=10 · P2=5 · total=36

### P0 (blockers)
- **P0 / broken_route** — `A` `/preise`
  - Public route /preise returned status 200 / empty body.
  - _Fix:_ Route reparieren oder Navigation entfernen.
- **P0 / broken_route** — `A` `/berufe`
  - Public route /berufe returned status 200 / empty body.
  - _Fix:_ Route reparieren oder Navigation entfernen.
- **P0 / dead_cta** — `A` `/`
  - Kein primärer CTA im sichtbaren Bereich der Homepage.
  - _Fix:_ Hero-CTA prüfen / cookie banner darf CTA nicht verdecken.
- **P0 / demo_unreachable** — `B` `/berufe`
  - Kein Produkt-Einstiegspunkt erreichbar.
  - _Fix:_ Produktkatalog reparieren.
- **P0 / dead_cta** — `D` `/dashboard`
  - Kein next-step CTA im Dashboard sichtbar.
  - _Fix:_ Primary-Next-Action im Dashboard.
- **P0 / white_screen** — `E` `https://berufos.com/muendliche-pruefung`
  - Oral-Oberfläche leer.
  - _Fix:_ Renderer / Datenpfad prüfen.
- **P0 / dead_cta** — `A` `/`
  - Kein primärer CTA above the fold.
  - _Fix:_ Hero-CTA sichtbar machen, Cookie-Banner darf CTA nicht verdecken.
- **P0 / broken_route** — `A` `/berufe`
  - Nur 0 Beruf-Links sichtbar — Visitor kann keinen Beruf finden.
  - _Fix:_ Berufs-Liste hydratisieren / SSR-Fallback prüfen.
- **P0 / broken_route** — `A` 
  - Visitor erreicht keine Kurs-/Produktseite ab Homepage.
  - _Fix:_ Berufe-Hub muss klickbare Karten mit echten Detail-Routen liefern.
- **P0 / workflow_no_feedback** — `A` `/preise`
  - Pricing-Seite zeigt keinen €/EUR-Preis.
  - _Fix:_ Pricing-SSOT auf /preise rendern (statt nur auf Produktseiten).
- **P0 / dead_cta** — `A` `/preise`
  - Pricing-Seite hat keinen sichtbaren Kauf-CTA.
  - _Fix:_ Primary-CTA pro Pricing-Tier hinzufügen.
- **P0 / dead_cta** — `A` 
  - Konnte keine Kursseite öffnen für CTA-Test.
  - _Fix:_ Erst P03 (Discovery) fixen.
- **P0 / checkout_unreachable** — `A` 
  - Konnte keine Kursseite öffnen — Checkout-Surface untestbar.
  - _Fix:_ P03 fixen.
- **P0 / broken_route** — `A` `/berufe`
  - Cold-load body too short (76 chars).
  - _Fix:_ SSR / static fallback für Route sicherstellen.
- **P0 / broken_route** — `A` `/berufe/einzelhandelskaufmann-frau`
  - Cold-load body too short (76 chars).
  - _Fix:_ SSR / static fallback für Route sicherstellen.
- **P0 / broken_route** — `A` `/berufe/kaufmann-frau-bueromanagement`
  - Cold-load body too short (76 chars).
  - _Fix:_ SSR / static fallback für Route sicherstellen.
- **P0 / broken_route** — `A` `/berufe/fachinformatiker-systemintegration`
  - Cold-load body too short (76 chars).
  - _Fix:_ SSR / static fallback für Route sicherstellen.
- **P0 / broken_route** — `A` `/berufe/kfz-mechatroniker-in`
  - Cold-load body too short (76 chars).
  - _Fix:_ SSR / static fallback für Route sicherstellen.
- **P0 / broken_route** — `A` `/berufe/bankkaufmann-frau`
  - Cold-load body too short (76 chars).
  - _Fix:_ SSR / static fallback für Route sicherstellen.
- **P0 / broken_route** — `A` `/berufe/fachkraft-fuer-lagerlogistik`
  - Cold-load body too short (76 chars).
  - _Fix:_ SSR / static fallback für Route sicherstellen.
- **P0 / broken_route** — `A` `/berufe/chemielaborant-in`
  - Cold-load body too short (76 chars).
  - _Fix:_ SSR / static fallback für Route sicherstellen.

### P1 (trust / conversion)
- **P1 / dead_button** — `C` `/dashboard`
  - Logout-Button nicht sichtbar im Header.
  - _Fix:_ Logout-CTA im App-Header sicherstellen.
- **P1 / demo_unreachable** — `E` `https://berufos.com/berufs-ki`
  - Keine MiniCheck-Frage erreichbar (Kurs evtl. ohne Quiz oder Selektor verschoben).
  - _Fix:_ data-testid="question-option-0" auf MiniCheck-Renderer halten.
- **P1 / demo_unreachable** — `E` `https://berufos.com/tutor`
  - Tutor-Input-Feld nicht sichtbar (eventuell Curriculum-Picker oder Paywall).
  - _Fix:_ Tutor-Gate prüfen (tutor_access_check / Curriculum-Auswahl).
- **P1 / workflow_no_feedback** — `A` 
  - Keine Kursseite erreichbar — Cross-Sell untestbar.
  
- **P1 / broken_route** — `A` 
  - Kein BerufOS-/Komplettpaket-Hub erreichbar (/berufos, /komplettpaket, /produkte).
  - _Fix:_ Mindestens eine Hub-Route mit Produkt-Erklärung publishen.
- **P1 / workflow_no_feedback** — `A` `/`
  - Homepage zeigt keinerlei Trust-Signale (Reviews, DSGVO, Garantie, Nutzerzahlen).
  - _Fix:_ Trust-Strip / Testimonial-Block / Sicherheits-Badges in Hero oder direkt darunter platzieren.
- **P1 / dead_cta** — `A` `/`
  - Primary CTA mobile nicht above-the-fold (>844px).
  - _Fix:_ Hero verkürzen oder Sticky-CTA für Mobile.
- **P1 / broken_route** — `A` `/`
  - Impressum-Link fehlt auf Homepage / im Footer.
  - _Fix:_ Footer-Block mit Impressum-Link ergänzen (DE-Recht / Stripe-Requirement).
- **P1 / broken_route** — `A` `/`
  - Datenschutz-Link fehlt auf Homepage / im Footer.
  - _Fix:_ Footer-Block mit Datenschutz-Link ergänzen (DE-Recht / Stripe-Requirement).
- **P1 / broken_route** — `A` `/`
  - AGB-Link fehlt auf Homepage / im Footer.
  - _Fix:_ Footer-Block mit AGB-Link ergänzen (DE-Recht / Stripe-Requirement).

### P2 (UX friction)
- **P2 / placeholder_end_state** — `F` `/dashboard`
  - Keine sichtbare Fortsetzungs-/Empfehlungs-Karte nach Re-Login.
  - _Fix:_ Continue-Card / Recommendation-Card im Dashboard.
- **P2 / workflow_no_feedback** — `A` `/berufe`
  - Keine Suche und wenige Berufe — Discovery-Friction.
  - _Fix:_ Such-/Filterleiste hinzufügen.
- **P2 / workflow_no_feedback** — `A` `/`
  - OG-Tags unvollständig (og:title=1, og:image=0).
  - _Fix:_ OG-Tags für Social-Preview rendern.
- **P2 / workflow_no_feedback** — `A` `/berufe`
  - OG-Tags unvollständig (og:title=1, og:image=0).
  - _Fix:_ OG-Tags für Social-Preview rendern.
- **P2 / workflow_no_feedback** — `A` `/preise`
  - OG-Tags unvollständig (og:title=1, og:image=0).
  - _Fix:_ OG-Tags für Social-Preview rendern.

## Recommended fix order
1. **P0** broken_route → Public route /preise returned status 200 / empty body.
2. **P0** broken_route → Public route /berufe returned status 200 / empty body.
3. **P0** dead_cta → Kein primärer CTA im sichtbaren Bereich der Homepage.
4. **P0** demo_unreachable → Kein Produkt-Einstiegspunkt erreichbar.
5. **P0** dead_cta → Kein next-step CTA im Dashboard sichtbar.
6. **P0** white_screen → Oral-Oberfläche leer.
7. **P0** dead_cta → Kein primärer CTA above the fold.
8. **P0** broken_route → Nur 0 Beruf-Links sichtbar — Visitor kann keinen Beruf finden.
9. **P0** broken_route → Visitor erreicht keine Kurs-/Produktseite ab Homepage.
10. **P0** workflow_no_feedback → Pricing-Seite zeigt keinen €/EUR-Preis.

---
_Generated by scripts/pre-customer-reality-aggregate.mjs — Pre-Login Funnel Reality, not architecture._
