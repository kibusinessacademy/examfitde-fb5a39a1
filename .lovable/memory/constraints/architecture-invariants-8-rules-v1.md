---
name: Architecture Invariants — 8 Hard Rules
description: 8 non-negotiable governance rules + meta-rule for every new feature/module. Replaces ad-hoc "please check before building" wishes.
type: constraint
---

# ARCHITECTURE INVARIANTS (8 Hard Rules) — FROZEN 2026-06-18

These are NOT wishes. They are **hard gates**. Every new feature/module/route/table/edge-fn/registry MUST satisfy all 8 + the meta-rule before merge.

## Meta-Rule (overrides all)

> Jedes neue Feature muss entweder (a) eine bestehende Fähigkeit erweitern, (b) eine identifizierte Lücke schließen, oder (c) mindestens zwei bestehende Module miteinander verbinden. Andernfalls darf es nicht gebaut werden.

If none of (a)/(b)/(c) applies → **REJECT, do not build**.

---

## 1. DUPLICATION.GUARD
Vor jedem Build Pflichtprüfung:
- Existiert ähnliches Modul / Route / ServerFn / SSOT / Registry?
- Falls ja → Status = `EXTEND_EXISTING`, niemals `CREATE_NEW`.

CI-Nachweis-Pflicht bei: neue Route, neue Tabelle, neue Registry, neue Edge-Function, neue Status-Familie. Ohne Nachweis warum bestehendes ungeeignet ist → BLOCK.

## 2. NO.REGRESSION.GUARD
Jeder Build muss vorhandene Features/Bridges/UX-Flows inventarisieren.  
Verbot ohne explizite Freigabe: Feature entfernen, Bridge entfernen, Workflow verkürzen, Kontext verlieren, Deep-Link brechen.

## 3. BRIDGE.REQUIRED
Jedes neue Modul beantwortet zwingend:
- Wovon kommt es? (Input-Quelle)
- Wohin führt es? (Output / Next Step)
- Wer nutzt es? (Persona/Rolle)
- Wer profitiert? (Downstream-Module)

Pflicht-Matrix: Input · Output · Deep-Link · Aktion · Folgeprozess. Fehlt eines → `ARCHITECTURE_GAP`, BLOCK.

## 4. GAP.CLOSURE.REQUIRED
Pflicht-Gap-Analysis vor Merge:
- Welche Lücke schließt es?
- Welche neue Lücke erzeugt es?
- Welche angrenzenden Module sind betroffen?

Isolierte Features ohne Gap-Bezug → REJECT.

## 5. UX.CONSISTENCY.GATE
Neue Screens müssen gleiche Terminologie, Aktionen, CTA-Logik, Farbsemantik, Navigationslogik wie bestehende Surfaces verwenden.  
Beispiel ExamFit: „Prüfung starten" / „Prüfung simulieren" — niemals „Training beginnen" / „Lernen starten" / „Quiz öffnen" parallel.  
Drift → REJECT.

## 6. E2E.WORKFLOW.REQUIRED
Verbot: Feature erzeugt Daten, aber niemand nutzt sie.  
Pflicht-Kette: Erfassung → Verarbeitung → Bewertung → Aktion → Folgeaktion → Audit.  
Jede neue Surface/ServerFn muss die vollständige Kette nachweisen oder einen explizit benannten bestehenden Anschluss-Punkt aktivieren.

## 7. UX.GAP.SCAN
Jeder größere Build beantwortet: **„Was muss der Nutzer danach tun?"**  
Antwort „manuell suchen" / „woanders hingehen" / „Daten erneut eingeben" → `UX_GAP`, BLOCK bis Brücke gebaut.

## 8. REALITY.VERIFICATION.REQUIRED
Nicht „Tests grün", sondern „User Journey funktioniert end-to-end".  
Pflicht: Reality-/E2E-Test über die vollständige Kette (z.B. Upload → OCR → Klassifikation → Zuordnung → Aufgabe → Frist → Audit). Customer Reality Gate (CORS) ist hier autoritativ.

---

## Anwendung
- Diese Regeln gelten für **jedes** neue Feature, unabhängig von Track/OS/Vertikale.
- Konflikt mit anderer Memory → diese Regeln gewinnen, außer Architecture-Freeze (der ist strenger).
- Verstoß muss im PR explizit deklariert + freigegeben werden (`INVARIANT_OVERRIDE: <rule> — reason: …`).

## Operationalisierung (nicht-blockierend, parallel zu erstellen)
- PR-Template-Section „Architecture Invariants Checklist" (8 Checkboxen + Meta-Rule).
- CI-Gate Phase A: Lint-Hint bei neuer Route/Tabelle/Edge-Fn (DUPLICATION.GUARD).
- CI-Gate Phase B: Reality-Verification Pflicht für neue End-User-Flows.
- Surface in `/admin/governance/architecture` (Architectural Continuity Guard) als zusätzliche 8-Regel-Matrix.
