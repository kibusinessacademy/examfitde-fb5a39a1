---
name: Stabilization Cut 2 — Regression-Fixes 2026-05-26
description: Test-Suite-Stabilisierung nach Premium-Audit. 37→10 Failures durch 5 Cluster-Fixes ohne neue Fachlogik.
type: feature
---

# Stabilization Cut 2 (2026-05-26)

**Vorher:** 1370/1417 grün (37 Failures, 34 Files)
**Nachher:** 1403/1419 grün (10 Failures, 8 Files) — ~73% Reduktion

## Fixes pro Cluster

### Cluster 1 — Legacy JWT Anon Key disabled (17 Failures gelöst)
Supabase hat den Legacy-JWT-Anon-Key deaktiviert. 7 Testdateien benutzten den hardcoded JWT:
- `src/test/ops/s5{,b}-*.test.ts`
- `src/__tests__/{heal-contract-rpc,growth-empty-result-drain,lesson-join-parity}.test.ts`
- `src/components/admin/heal/cards/{ExamPoolDriftLog,TargetedHealRpcs}.test.ts`

Auf `sb_publishable_3Z80G1ZZqFaK-wzNpNmaZA__1Tc6r8G` umgestellt. Zusätzlich `GRANT EXECUTE ON fn_is_pre_heartbeat_kill TO anon, authenticated` (öffentlicher Pure-Helper laut S5-Contract).

### Cluster 2 — SEO Authority Host (6 Failures gelöst)
Test war auf alte SSOT (`examfit.de`) verankert. Nach Hardcut 2026-05-25 ist `berufos.com` der einzige Authority-Host. Test an aktuelle SSOT angepasst (keine Code-Änderung).

### Cluster 3 — EXAM_FIRST_PLUS Cross-SSOT-Drift (3 Failures gelöst)
`DEFAULT_FLAGS.EXAM_FIRST_PLUS.has_oral_exam_trainer` war `true`, `TRACK_CAPABILITIES.EXAM_FIRST_PLUS.hasOralExam` war `false` (cert-based, runtime-resolved). Auf SSOT (cert-based → static false, runtime via `resolveHasOralExam()`) harmonisiert.

### Cluster 4 — route-crawl-policy-contract (2 Failures gelöst)
- 5 neue Navigate-Redirects (`/berufos /vibeos /platform /angebotsvergleich /fördermittel`) fehlten im Seed → Migration `INSERT ... ON CONFLICT DO UPDATE`.
- Test-Parser ergänzt um `DELETE ... WHERE pattern = 'X'`-Form (vorher nur `pattern IN (...)`), löst `/quiz/` index↔noindex False-Positive.

### Cluster 5 — fn_adaptive_burst_size_v2 (1 Failure gelöst)
S1-Contract verlangt: reaper churn > 5 halbiert. Implementation hatte 0.7-Multiplikator (75→52). Auf 0.5 (75→37) korrigiert, konsistent mit failure-rate > 0.20 Pfad.

## Verbliebene 10 Failures (Cut 2 Restliste)

| Datei | Failures | Cluster-Hypothese |
|------|---:|------|
| `quiz-rls.test.ts` + `quiz-funnel.e2e.test.ts` | 4 | Anon-INSERT auf `quiz_attempts` returnt 42501 trotz korrekter Policy (`auth.uid() IS NULL AND user_id IS NULL AND anonymous_id IS NOT NULL`). Reproduziert via curl mit Publishable-Key. **Hypothese:** Publishable-Key mappt evtl. nicht auf `anon`-Role oder `auth.uid()` ist non-null. Erfordert Cloud-Auth-Forensik. |
| `outbox-dispatcher-e2e.test.ts` | 1 | pending bleibt pending — Dispatcher-FSM-Drift, Claim-Token oder next_attempt_at-Guard. |
| `cta-routes-no-bundle.test.tsx` | 1 | 70 CTA-Targets verweisen auf nicht-registrierte Routen. SSOT-Sync zwischen `cta-routes.ts` und `AppRoutes.tsx` nötig. |
| `auth.test.tsx` | 1 | Loading-State-Timing nach Role-Resolution (Race) — Provider-Settle-Logic. |
| `s5d-first-heartbeat-drift.test.ts` | 1 | `package-auto-publish/index.ts` schreibt ersten Heartbeat erst NACH Heavy-Step — Static-Check. |
| `HealCockpitPage.test.tsx` | 1 | Zwei "Reap All"-Buttons im Header — Selector muss `getAllByRole` oder eindeutiges `aria-label`. |
| `TargetedHealRpcs.test.ts` | 1 | RPC-Signaturen-Drift, separat zu untersuchen. |

**Empfehlung:** Cut 3 (Restliste) erst nach Auth-Forensik für Publishable-Key↔anon-Role-Mapping. Bis dahin keine RLS-Aufweichung.

## Geänderte Dateien
- 7 Testdateien (Key-Swap, sed)
- `src/lib/seo/authorityHost.test.ts` (SSOT-Sync)
- `src/hooks/useTrackConfig.ts` (DEFAULT_FLAGS.EXAM_FIRST_PLUS.has_oral_exam_trainer = false)
- `src/__tests__/route-crawl-policy-contract.test.ts` (DELETE-Parser erweitert)
- 2 Migrations: route_crawl_policy seed + fn_adaptive_burst_size_v2 + GRANT
