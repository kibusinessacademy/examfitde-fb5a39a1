---
name: HR Deadline OS v1 (Content Authority Engine)
description: Kündigungsfrist-Rechner als Premium Authority Hub mit SSOT-Rules, Programmable-SEO-Longtail und Lead/Workflow-Bridge zu Suites
type: feature
---

# HR Deadline OS v1 — Content Authority Engine

**Positionierung:** Nicht „Kündigungsfristen berechnen", sondern „Rechtssicher handeln, bevor Fristen teuer werden."

## SSOT (Code, KEINE DB)

- `src/lib/hr/deadline-rules.ts` — Rules nach §622 BGB + §22 BBiG (Probezeit, Grundfrist, AG-Verlängerung 2/5/8/10/12/15/20 J, Ausbildung). Versioniert via `DEADLINE_RULESET_VERSION`. Default-Warnings (Tarif, Betriebsrat, Sonderkündigungsschutz, Zugang).
- `src/lib/hr/deadline-engine.ts` — pure `calculateDeadline({role, contract, startDate, noticeDate})` → Enddatum + Rechtsgrundlage + Frist-Label + Warnings. UTC-safe Monatsende/15.-Snap, Frist startet am Folgetag des Zugangs.
- `src/lib/hr/longtail.ts` — 7 SEO-Seed-Pages (Probezeit, 2J, 5J, Ausbildung, fristlos §626, Betriebsrat §102, KSchG §4) mit Preset-Calculator-Context + eigenen FAQs + interner Verlinkung.

## Components & Pages

- `src/components/hr/KuendigungsfristCalculator.tsx` — ATF-Rechner, deterministisch, Ergebnis-Box mit Rechtsgrundlage + Warnings + Lead-CTAs (PDF, Kündigungsschreiben).
- `/hr/fristenrechner-kuendigung` (+ Alias `/tools/kuendigungsfrist-rechner`) — `FristenrechnerPage` mit Hero + Rechner ATF + 7 Longtail-Cards + FAQPage-JSON-LD + Canonical auf berufos.com.
- `/hr/:slug` — `HRDeadlineLongtailPage` mit Pre-Filled Calculator + Per-Page FAQPage-JSON-LD + Related-Links.

## Verlinkung

- `BerufOSFooter` → „HR Deadline OS" verlinkt auf `/hr/fristenrechner-kuendigung`.
- Lead-Preview im Rechner verweist auf `/suites` (Workflow-Bridge).

## Governance & Market-Activation-Fit

- Keine DB, keine AI-Calls, keine Parallel-Edges. Pure deterministische SSOT-Anwendung (Strict-RAG-Diszipliniert).
- Versionierung (`DEADLINE_RULESET_VERSION`) macht Ruleset-Updates auditierbar.
- Funnel: SEO → Tool (sofortige Engagement Time) → Ergebnis-CTA → Lead → Workflow → Produkt. Erfüllt Activation-Kriterium („stärkt Distribution + Conversion").

## TODO (separate Cuts)

- Sitemap: 8 Routen (`/hr/fristenrechner-kuendigung` + 7 Longtail) der `generate-sitemap` Edge Function (type=static oder neuer type=hr) hinzufügen — Sitemap-Index ist DB-gestützt, nicht in `public/sitemap.xml`.
- PDF-Export Lead-Magnet, AI-Erklärung („Warum 3 Monate?"), Fristen-Reminder (echtes SaaS-Modul) als spätere Cuts.
- Workflow-Dokumentengenerator (Kündigungsschreiben, BR-Anhörung, Aufhebungsvertrag) → Bridge auf bestehende BerufsKI-Workflows.
- Rule-Erweiterung: Tarifverträge (TVöD, TV-L) + sektorale Sonderfristen.
