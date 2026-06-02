## Ausgangslage

Auth-Logs zeigen seit Stunden `403 bad_jwt / invalid claim: missing sub claim` auf `/auth/v1/user` — Learner-Login ist real broken (deckt sich mit Bug-Report). Das ist der Blocker Nr. 1. Erst danach Premium-Aufbau.

R-Reihenfolge (sequenziell, je mit Reality-QA verifiziert):

---

## R1 — QA-Fundament & Auth-Stabilität (Blocker)

**Ziel:** Login funktioniert wieder, E2E-Pipeline läuft grün.

1. **Auth-bad_jwt Root-Cause**
   - `src/hooks/useAuth.ts` und Session-Bootstrap auf abgelaufene/stale Tokens prüfen
   - Bei `invalid claim: missing sub claim` → defensiv `supabase.auth.signOut({ scope: 'local' })` + Storage-Wipe, Re-Hydration sauber
   - Kein Schema-Change, nur Client-Hardening

2. **Seeder + Workflow finalisieren**
   - `scripts/qa/seed-auth-test-users.mjs` (bereits angelegt) gegen echte DB testen
   - GitHub Workflow `.github/workflows/auth-org-context-e2e.yml` validieren — Secrets-Mapping bestätigen

3. **Reality-Triage-Bridge**
   - Auth-Spec in `tests/customer-reality/journeys/c-login.spec.ts` Pfad einbinden, damit CORS-Score den Auth-Fix reflektiert

---

## R2 — B2B Org Console Premium-Politur

**Ziel:** `/app/org/:orgId` fühlt sich wie Enterprise SaaS an. Keine neuen Tabellen, keine neuen RPCs (SSOT-Freeze respektieren).

1. **Loading/Empty/Error-States überall**
   - Members-Liste, Invites, Licenses: Skeletons (shimmer v3), Empty-Illustrationen, Retry-CTAs
   - Last-Owner-Protection im UI sichtbar machen (disabled Button + Tooltip warum)

2. **Audit-Sichtbarkeit**
   - Activity-Tab: `org_member_role_changed`, Invite-Lifecycle aus `audit_log` lesen (RLS-gated, vorhandene View nutzen)

3. **Premium-Motion**
   - `reveal-up`, `shimmer`, `in-out-quint` auf Karten + Tab-Transitions
   - `shadow-elev-*` + `surface-*` Tokens für Konsistenz

---

## R3 — Design-System v3 konsequenter Rollout

**Ziel:** Premium-Konsistenz auf App-Shell + Learner-Dashboard.

1. AppShell-Header/Sidebar auf text-/surface-/border-Tokens umstellen wo noch hartcodiert
2. density-Modi (compact/comfortable) auf Org-Console-Tabellen testen
3. Drift-Guard: `scripts/guards/namespace-drift-guard.mjs` + Design-Token-Audit laufen lassen

---

## Verifikation (nach jeder R-Phase)

- TS-Build
- `scripts/qa/b2b-org-reality-report.mjs`
- `tests/customer-reality/journeys/c-login.spec.ts` + `tests/e2e/org-reality.spec.ts`
- Nach R3: Full `tests/customer-reality/learner/*` Suite

## Technische Leitplanken

- **Keine neuen Tabellen, keine neuen RPCs** (Continuity Guard #3 NO_PARALLEL_SYSTEMS, Architecture Freeze)
- Nur Frontend + Hooks; Edge Functions nur falls Auth-Bug serverseitig sitzt
- snake_case an allen Boundaries (`docs/SSOT_NAMING_CONTRACT.md`)
- Memory-Updates für jeden gelandeten Cut

## Was NICHT passiert

- Keine neue Core-Architektur (Market Activation Pivot)
- Keine S2/S3 Intelligence-Themen vor R4
- Kein Refactor an Safe-Tool/Clustering/Memory-Bridge (FROZEN)
- Keine Anti-Drift-Themen (IQ-Tests, Bundeswehr, Polizei, …)

---

**Frage vor Start:** Bestätigst du R1 (Auth-Fix + QA-Pipeline) als ersten Cut? Sobald Login grün ist, gehe ich nahtlos R2 → R3 durch und reporte zwischen den Phasen.