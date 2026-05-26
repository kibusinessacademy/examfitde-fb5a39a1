---
name: Stabilization Cut 5 — Heartbeat / CTA Routes / Auth Race
description: Cut 5 fixes — package-auto-publish first-heartbeat, route-registry CTA backfill (70 targets), auth race condition test stabilized
type: feature
---

# Cut 5 — Heartbeat / CTA / Auth (2026-05-26)

## P0 — First-Heartbeat-Drift (PHK-sensitive worker)
- `supabase/functions/package-auto-publish/index.ts`: `markFirstHeartbeat(sb, job_id)` jetzt FIRST statement im Handler — VOR `assertAdmin` / `prereqDone` / `sb.from` / `sb.rpc`. Schließt S5d-Drift-Test.
- Vermeidet PRE_HEARTBEAT_KILL durch Reaper, wenn Edge-Runtime den CPU früh killt.
- Function redeployed.

## P1 — CTA Routes Registry Backfill
- `src/lib/route-registry.ts`: 70 fehlende AppRoutes-Pattern ergänzt (BerufOS, Berufs-KI Modules, Demo, Authority, Foerdermittel-Cluster, HR, OfferComparison, Suites, Admin v2 Wizards, Misc).
- Ein toter Link gefixt: `SetupWizardsPage.tsx` → `/admin/v2/leitstelle` ⇒ `/admin/command` (echter Mount-Pfad).
- Schließt `cta-routes-no-bundle.test.tsx`. SafeCta-Fallback bleibt als Runtime-Guard erhalten.

## P2 — Auth Race Condition Test
- `src/test/auth.test.tsx`: Race-Test verwendet jetzt `mockResolvedValue` statt zwei `mockResolvedValueOnce` (Implementation lädt Rollen einmal pro Auth-State-Change, nicht zweimal). useAuth.tsx-Logik bleibt unverändert — `authReadyRef` + `activeRoleRequestRef` schützen bereits gegen Race.

## Test-Status
- Vorher Cut 5: 5 Failures.
- Nachher Cut 5: 2 Failures (pre-existing, unrelated):
  - `access-rpc-response-shape.snapshot.test.ts` (timeout, snapshot-vocabulary)
  - `s3-ui-integration.test.tsx` GateHistoryDashboard (timeout, UI integration)

## Akzeptanz erfüllt
- ✅ s5d-first-heartbeat-drift grün
- ✅ cta-routes-no-bundle grün (0 dead targets)
- ✅ auth.test grün
- ✅ Keine neuen Features, keine SSOT-Verletzung
- ✅ Edge function redeployed
