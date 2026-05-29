---
name: BerufOS Hub Auth-Aware Re-Entry v1
description: D8-Fix — eingeloggte Besucher auf / werden NICHT mehr in das ExamFit-gebrandete /dashboard redirected. AuthHomeRoute rendert für alle BerufOSHub; eingeloggte sehen im Hero ein Re-Entry-Banner zu /dashboard. Brand-Home = BerufOS, auth-unabhängig.
type: feature
---
# BerufOS Hub Auth-Aware Re-Entry (D8)

## Problem
`AuthHomeRoute` redirected `user → /dashboard` (LearnerDashboard = ExamFit-Lerner-Surface). Folge: Brand-Home wechselt je nach Login-Status zwischen BerufOS (anon) und ExamFit (auth) — klassischer Brand-Drift. Audit-Finding D8 (P2).

## Fix
- `src/components/auth/AuthHomeRoute.tsx`: Force-Redirect entfernt. Lädt für alle den BerufOSHub.
- `src/pages/BerufOSHub.tsx`: `useAuth()` + bedingtes Re-Entry-Banner im Hero ("Willkommen zurück · Weiter im Lern-Dashboard →" → `/dashboard`).

## Strukturelle Lehre
Brand-Heimat ist auth-unabhängig. Login darf den User personalisieren (Banner, CTAs, Recommendations), aber nicht die Brand-Identity der Root-Route wechseln. Personalisierung = additiv, nie substitutiv.

## Wirkung
- `/` zeigt für alle Besucher konsistent BerufOS-Hub (Masterbrand, Plattform-Narrative, 10 Module).
- Eingeloggte verlieren keinen Pfad: explizites Banner → /dashboard, kein Klick mehr als vorher (vorher wurden sie automatisch dorthin gespült).
- ExamFit-Brand bleibt sauber gekapselt unter `/dashboard`, `/examfit`, `examfit.de` Surfaces.

## Nicht enthalten
- Persona-bewusster Re-Entry (B2B → /admin, Recruiter → /berufos/recruit etc.) — heutige Logik kennt keine persona pro User.
- Auto-Open des Personality-Filters basierend auf User-History.
- A/B-Test Banner vs Hard-Redirect — Annahme: Brand-Konsistenz > 1 Klick weniger.
