---
name: BerufOS ModuleLandingShell Preview-CTA-Fallback v1
description: D4-Fix — preview-Module ohne href bekommen automatisch Waitlist-CTA ("Frühen Zugang anfragen") statt totem Hero. PrimaryCta + Footer-CTA-Section gleich verzweigt.
type: feature
---
# BerufOS ModuleLandingShell — Preview-CTA-Fallback (D4)

## Problem
`/skills` (SkillGraph, status=preview) hatte keinen `href` in `BERUFOS_MODULES` und damit keinen Primary-CTA — `PrimaryCta` returnte `null`, Footer-CTA-Section zeigte nur den Promise-Text. Audit-Finding D4 (P1).

## Fix
`src/components/berufos/ModuleLandingShell.tsx`:
- **PrimaryCta**: Branch erweitert auf `status === "planned" || (status === "preview" && !href)` → Anchor `#waitlist` mit Label "Frühen Zugang anfragen" (preview) bzw. "Auf die Warteliste" (planned).
- **Footer-CTA-Section**: gleiche Verzweigung → `<PlannedWaitlist>` rendert für preview-ohne-href identisch.

## Strukturelle Lehre
Module-Status `preview` ist semantisch unterspezifiziert: "es gibt eine UI" vs "wir zeigen Interesse, kein Deep-Link". Statt jeden Slug einzeln zu pflegen, fallbackt der Shell auf Waitlist — gilt damit für alle künftigen preview-Module ohne href (z.B. künftige Demo-Surfaces vor Deep-Link-Bereitschaft).

## Betroffen
Aktuell nur `skills` (SkillGraph). `agents` (/admin/berufs-ki/agents), `governance` (/admin/governance/architecture) haben href → unverändert.

## Nicht enthalten
- Eigene preview-CTA-Variante (z.B. "Demo buchen" via Calendly) — Waitlist-Email reicht für Lead-Capture.
- Status-Differenzierung in Email-Sequenz (`berufos_waitlist_<slug>` ist unverändert SSOT).
