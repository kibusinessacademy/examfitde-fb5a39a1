---
name: BerufOS Workflow Audit — Admin/Public href Split v1
description: W1-Fix — Preview-Module agents+governance hatten `href` auf Admin-Only Routes → Public-User landete auf Login-Wall, D4-Waitlist-Brücke wurde umgangen. Trennung in public `href` + additiver `adminHref` (nur sichtbar für Admins). Test-Invariante schützt strukturell.
type: feature
---
# BerufOS Workflow Audit — Admin/Public href Split (W1)

## Problem
Audit der BerufOS-Modul-Workflows zeigte: Zwei Preview-Module hatten `href` auf Admin-Only Routes gesetzt:
- `agents` → `/admin/berufs-ki/agents`
- `governance` → `/admin/governance/architecture`

Folge: Public-Besucher klickte "Preview ansehen" → Login-Wall / 404. Die D4-Waitlist-Brücke (preview-without-href → Waitlist) griff NICHT, weil ein href ja gesetzt war. Brand-Promise "Plattform entdecken" gebrochen für genau die zwei Module, die am ehesten Interesse wecken (Agents + Governance = Burggraben-Differenzierer).

## Fix (Brücke, kein Doppelbau)
- `BerufosModule.adminHref?: string` als separates Feld eingeführt — semantisch klar von public `href` getrennt.
- `agents` + `governance`: `href` → `adminHref` verschoben. D4-Waitlist-Brücke greift jetzt automatisch (preview ohne public href → Waitlist).
- `ModuleLandingShell` rendert `<AdminShortcut>` neben Primary-CTA — **nur wenn `useAuth().isAdmin === true` UND `adminHref` gesetzt**. Additive Personalisierung gemäß D8-Prinzip (nie substitutiv).
- Test-Invariante `module-registry.test.ts`: `m.href` darf NIE mit `/admin/` beginnen → strukturelle Garantie gegen Regression.

## Strukturelle Lehre
Brand-Surface = Public-First. Jeder public-sichtbare Link muss public-erreichbar sein. Admin-Deep-Links sind additive Personalisierung — sie erweitern die Surface für berechtigte User, ersetzen sie aber nie. Dieselbe Grammatik wie D8 (Hub-Re-Entry): Login personalisiert, ersetzt nicht.

Zweite Lehre: Workflow-Brücken (D4) sind nur so stark wie ihre Trigger-Bedingung. `preview && !href` ist ein engerer Trigger als beabsichtigt — sobald irgendein href existiert, fällt die Brücke aus. Lösung: Semantische Felder (`adminHref` ≠ `href`) statt eines polymorphen Feldes mit Spezialfällen.

## Wirkung
- `/berufos/agents` und `/berufos/governance`: Public sieht Waitlist (Lead-Erfassung), Admin sieht Waitlist + dezenten "Admin-Surface öffnen" Link.
- Keine toten CTAs mehr im Hub für Preview-Module.
- Test-Invariante verhindert, dass künftige Module versehentlich Admin-Routen als public href setzen.

## Nicht enthalten
- Role-aware Public-Surface (z.B. "Du bist Recruiter → direkt zu RecruitOS-Preview"): wartet auf User-Persona-Tracking.
- Auth-Gate-Audit für `/admin/*` Routen (separate Concern, nicht workflow-audit).
- A/B-Test "Waitlist vs Calendly-Call" für Burggraben-Module — Annahme: Email-Capture ist erste Conversion-Stufe.

## Bezug
- D4 (preview-no-href Waitlist-Brücke) — diese Migration vervollständigt sie.
- D8 (auth-aware Re-Entry, additiv) — gleiches Prinzip auf Modul-Ebene.
