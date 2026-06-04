---
name: Funnel Freeze until CORS green v1
description: Bis Customer Reality Gate ≥10/12 PASS liefert, keine Funnel-fremden Features bauen. Nur P0-Reparatur am Conversion-Pfad.
type: constraint
---

# Funnel Freeze — bis Customer Reality Gate grün

**Aktiv ab:** 2026-06-04
**Aufhebung:** Customer Reality Gate liefert an 3 aufeinanderfolgenden Tagen `verdict=RELEASE` (≥10/12 Journeys PASS).

## Warum

System-Audit 2026-06-04: 544 Edge Functions, 3.130 Tabellen, 367 Routen — aber nur **2/10 Customer Funnel** und **3/10 Kaufbarkeit heute**. Die Diskrepanz zwischen Systemkomplexität und Kundennutzen ist der eigentliche Engpass. Jede weitere Architektur-, Council-, Heal-, Cron- oder Analytics-Arbeit erhöht aktuell nur die Komplexität, nicht den Umsatz.

## Was verboten ist (bis Gate grün)

- Neue Councils, Heal-Systeme, Cron-Jobs, Analytics-Wellen
- Neue Workflows / Marketplace / Referral / Gamification
- Neue SEO-Wellen oder Crawler-Bridges
- Neue Edge-Functions außer als direkte P0-Reparatur
- Neue Tabellen außer als direkte P0-Reparatur
- Refactors / Renames die keinen P0-Finding schließen

## Was erlaubt ist

1. **P0-Reparatur** der 6 Funnel-Blocker (Hero-CTA, /preise, /berufe SSR, Oral-Trainer, Dashboard-Next-Step, Demo-Pfad).
2. **Reality-Gate-Stabilität** (Aggregatoren, Test-Selektoren, Login-Flag).
3. **Sicherheitskritische Fixes** (RLS-Lücken, Secret-Leaks).

## Wie geprüft

Jede neue Änderung muss **eine** der folgenden Fragen mit Ja beantworten:

- Schließt diese Änderung einen P0-Finding aus `reality-results/findings/*.json`?
- Hebt diese Änderung ein `journey-pass/*.json` von `fail` auf `pass`?
- Repariert sie das Customer Reality Gate selbst (Aggregator, Selektor, Login)?
- Schließt sie eine RLS-/Security-Lücke?

Wenn **Nein** → nicht bauen. Antwort in PR-Beschreibung verlinken.

## Gate-Mechanik

- Workflow: `.github/workflows/customer-reality-gate.yml` (06:47 UTC daily + workflow_dispatch).
- Script: `scripts/customer-reality-gate.mjs` (Bridge über learner-reality + pre-customer-reality, kein Fork).
- Output: `reality-results/customer-reality-gate.{json,md}`.
- Regel: PASS≥10 → RELEASE · 8..9 → REVIEW · <8 → BLOCK.

## Aufhebung

Nach 3 konsekutiven RELEASE-Tagen: Memory durch `constraints/funnel-stability-watch-v1.md` ersetzen (Watch-only statt Freeze).
