---
name: Question-First + Action-First Principle v1
description: UX-Abnahmekriterium. Jede Seite/Funktion muss 6 Ja-Fragen erfüllen (Frage, Orientierung, Interaktivität, Workflow, Unterstützung, Ergebnis), sonst gilt sie als nicht fertig.
type: constraint
---

# Question-First + Action-First Principle v1

Eine Funktion/Seite gilt erst als fertig, wenn ALLE 6 Fragen mit „Ja" beantwortet werden:

| # | Dimension | Pflicht-Frage |
|---|-----------|---------------|
| 1 | **Frage** | Beantwortet die Seite eine konkrete Nutzerfrage? |
| 2 | **Orientierung** | Versteht der Nutzer sofort die aktuelle Situation? |
| 3 | **Interaktivität** | Kann der Nutzer direkt handeln? |
| 4 | **Workflow** | Ist der nächste Prozessschritt sichtbar? |
| 5 | **Unterstützung** | Erhält der Nutzer eine professionelle Empfehlung? |
| 6 | **Ergebnis** | Kommt der Nutzer seinem Ziel messbar näher? |

Ein „Nein" = fachlich/UX-seitig nicht abgeschlossen. Kein Merge, kein „done".

## Anwendung
- Pflicht-Check vor jedem PR/Feature-Abschluss
- Pflicht-Check in QA-Audits, Reality Repair Dashboard, Pre-Brief (Growth OS)
- Bei „Nein": konkrete Repair-Action im `auto_heal_log` oder Repair-Backlog dokumentieren

## Querverweise
- `mem://constraints/growth-os-framework-v1`
- `mem://constraints/admin-ui-leitstelle-v1`
- `mem://constraints/shop-ui-conversion-v1`
- `mem://architektur/qa/customer-reality-framework`
