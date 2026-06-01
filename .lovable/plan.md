
# B2B Org Reality QA v1

Ziel: Den gesamten B2B-Flow ohne neue Architektur verifizieren. Bestehende RPCs/RLS prüfen, Guards verankern, Reality Report generieren.

## Scope (Prüfkette)

1. Org-Owner → `/app/org` lädt
2. Mitglied einladen (Single + Bulk)
3. Invite-Link öffnen + Mismatch-Check
4. Einladung annehmen → Membership aktiv
5. Rolle ändern (Owner/Admin/Manager/Learner)
6. Lizenz/Sitz zuweisen + Zugriff auf Kurs (`learner_course_grants`) verifizieren
7. Audit-Events in `auto_heal_log`
8. RLS Cross-Org-Block
9. Last-Owner-Schutz

## Lieferumfang

### 1. SQL-Migration (RPC-Härtung, keine neuen Tabellen)

- `fn_assert_not_last_owner(_org_id, _user_id)` — RAISE EXCEPTION wenn letzter Owner.
- Trigger `trg_org_membership_protect_last_owner` BEFORE UPDATE/DELETE auf `org_memberships`: blockt Demotion oder Löschung des letzten Owners. Audit `org_last_owner_protected`.
- RPC `qa_reality_seed_b2b_fixtures()` (service_role only, `is_e2e_smoke_user()` Gate): Erstellt Org A (Owner+Manager+Member), Org B (Owner), 1 License + 1 Seat → idempotent via fixed UUIDs mit `@examfit-smoke.local`-Emails. Cleanup-Pendant `qa_reality_cleanup_b2b_fixtures()`.
- Audit-Contract-Registrierungen: `org_last_owner_protected`, `org_reality_qa_run`, `org_reality_qa_finding`.

### 2. Vitest RPC/RLS Guard Suite

Datei: `src/test/qa/org-reality-rpc.test.ts` (verwendet bestehendes Test-Setup, anon/service-role Supabase-Clients aus `.env`).

Geprüft:
- `list_org_members` als Owner Org A → sieht A-Mitglieder, NICHT Org B (`ORG_CROSS_ORG_LEAK`)
- `create_org_invitation` als Manager Org A → ok; als Member → denied
- `update_org_member_role`: Owner → Owner demote letzten Owner → muss failen (`ORG_LAST_OWNER_NOT_PROTECTED`)
- `assign_org_license_seat` → schreibt `learner_course_grants` (verify via select) (`ORG_SEAT_ASSIGNMENT_FAILED`)
- `revoke_org_invite` Cross-Org → denied
- Audit-Check: nach jeder Mutation Eintrag in `auto_heal_log` (`ORG_AUDIT_MISSING`)

### 3. Playwright Reality Test (lightweight, ohne echten Stripe/E-Mail)

Datei: `tests/e2e/org-reality.spec.ts` (neuer Ordner, Playwright-Config minimal hinzu falls fehlend; sonst auf bestehende Config aufbauen).

Flows:
- Login als Org-Owner via API (`supabase.auth.signInWithPassword`)
- Navigate `/app/org` → Dashboard sichtbar (`ORG_DASHBOARD_NOT_REACHABLE`)
- Invite-Dialog → Submit → Toast + Invite in Liste (`ORG_INVITE_FAILED`)
- Token aus DB lesen → `/org/einladung/:token` öffnen als 2. User → Accept (`ORG_INVITE_ACCEPT_FAILED`)
- Rolle ändern via UI → Bestätigung (`ORG_ROLE_CHANGE_FAILED`)
- Seat zuweisen → Course-Zugriff auf `/app/lernen` als Member (`ORG_SEAT_ASSIGNMENT_FAILED`)

Falls Playwright im Sandbox-Env nicht ausführbar: Test-Spec wird trotzdem committed + dokumentiert; Vitest deckt die kritischen Backend-Gates ab.

### 4. Reality Report Generator

Script: `scripts/qa/b2b-org-reality-report.mjs`
- Führt Vitest-Suite aus, parst Ergebnisse
- Liest aktuelle DB-Zustände (RLS-Probes via anon + service-role)
- Schreibt `auto_heal_log` Audit `org_reality_qa_run` mit `findings[]` (codes + status)
- Konsolen-Output mit Gate-Decision:
  - `RELEASE` — alle kritischen grün
  - `REVIEW` — nur UX-Codes
  - `BLOCK` — RLS/Lizenz/Invite/Owner-Schutz-Fehler

### 5. Memory + Dokumentation

- `mem://architektur/qa/b2b-org-reality-qa-v1.md` — Findings-Codes, Gate-Logik
- Index-Eintrag

## Out of Scope

- Keine neuen Tabellen
- Keine echten Stripe-Zahlungen oder E-Mails
- Keine neue UI
- Keine parallele Org-Engine
- Kein Webhook-Live-Test (separater Cut)

## Technische Details

- Test-Fixtures via existierendes Test-Fixture-Contract-Pattern (`@examfit-smoke.local`)
- `fn_emit_audit` für alle neuen Audit-Writes (Contract zuerst registrieren)
- Trigger nutzt `session_replication_role='replica'`-Bypass NICHT — Last-Owner-Schutz ist hart
- Vitest läuft mit existierender Config (`src/test/setup.ts`)

## Reihenfolge

1. Migration (Contracts, Trigger, Seed-RPCs)
2. Vitest Suite
3. Playwright Spec
4. Report-Script
5. Memory + Doku
6. Smoke-Run, Reality Report ausgeben
