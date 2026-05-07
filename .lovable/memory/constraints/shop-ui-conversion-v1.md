---
name: Shop UI Conversion-System v1
description: Produktseiten sind Conversion-Systeme. Pflicht Hero(Persona+Ziel+Nutzen)+ATF Primary-CTA „Prüfungssimulation starten"+Trust+Einwand+FAQ schema.org+≥3 interne Links+Mobile Hero+Tracking {package_id,persona}.
type: constraint
---

# Shop UI = Conversion-System

## Pflicht-Anatomie jeder Produktseite
1. **Hero ATF**: Persona + Prüfungsziel + Nutzen + Primary CTA — alles im 411×763 Mobile-Viewport sichtbar
2. **Primary CTA = „Prüfungssimulation starten"** (nicht „Kaufen") — führt in Demo/Lead-Funnel
3. **Persona-Argumente** (3–5 Bullets, persona-matched aus `growth.persona_overlays`)
4. **Trust-Block**: Bestehensquote / Blueprint-Hinweis / Quellen
5. **Einwandbehandlung** Top 3–5 (Preis, Zeit, Qualität, Aktualität)
6. **FAQ-Block** + `FAQPage` schema.org JSON-LD
7. **Pricing transparent** (mit Mehrwert-Vergleich)
8. **Interne Links** ≥3 zu Cluster-Geschwistern + 1 Money-Page
9. **Tracking** `product_viewed` mit `{package_id, persona, source, cluster_id}` SSOT-konform

## Performance Pflicht
- Mobile Hero critical-CSS <100kb
- Lazy-Load alles unterhalb Fold
- Kein schweres Client-State im initialen Bundle
- Bilder mit `width`/`height`/`loading="lazy"` außer Hero
- Core Web Vitals: LCP <2.5s, CLS <0.1, INP <200ms

## SEO Pflicht
- `<SEOHead>` mit Title <60ch (Keyword + Persona), Meta <160ch (Nutzen + CTA)
- Single H1 mit Primary-Keyword
- Canonical absolut
- `Product` oder `Course` schema.org JSON-LD
- Alt-Texte auf allen Bildern

## A11y Pflicht (WCAG AA)
- Semantisches HTML (`<main>`, `<section>`, `<nav>`)
- Tastatur-Fokus sichtbar
- aria-label auf icon-only Buttons
- Color-Contrast über Tokens (kein `text-white` hardcoded)

## Verboten
- „Jetzt kaufen" als Primary CTA (nur als Sekundär nach Demo)
- Hero ohne Persona-Bezug
- AI-Calls aus Client
- `text-white`/`text-black` literal
- Inline-Styles für Themes

## Pre-Brief Pflicht (vor neuer Shop-Page)
- Welche Persona? Welcher Cluster? Welcher Funnel-Stage?
- Welche Money-Page ist Conversion-Ziel?
- Welche 3 Top-Einwände?
- Welcher LLM-Visibility-Block (Definition? Liste? Tabelle?)

## Querverweise
- `mem://constraints/growth-os-framework-v1`
- `docs/GROWTH_OPERATING_SYSTEM.md` §4
- `docs/SHOP_STRATEGY.md`
