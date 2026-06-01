## Ziel

Vollständige B2B Org-Konsole als Premium-Erlebnis: vom Checkout über Mitarbeiter-Einladung, Rollen-Zuweisung, Seat-Management bis hin zu RLS-Härtung — alles in einem konsistenten, hochwertigen UI.

## Scope

Das ist ein großer Cut. Ich teile in 6 logische Wellen, die ich nacheinander in **einer Antwort** durchziehe (kein Approval pro Welle). Migrations werden am Stück angelegt, UI parallel.

---

### Welle 1 — Checkout → Auto-Provisioning (Backend)

**Problem:** Stripe-Webhook erstellt heute `learner_course_grants` nur für den Käufer. Bei B2B-Käufen (Quantity > 1, `metadata.org_id`) muss stattdessen eine **Org-License** mit N Seats angelegt werden.

**Lösung:**
- Edge `create-product-checkout` erweitern: optionaler Parameter `org_id` + `quantity` → Stripe Checkout mit `metadata.purchase_type=b2b_license`, `metadata.org_id`, `metadata.seats=N`
- Edge `stripe-webhook` (resp. `process-order-paid-fulfillment`) Branch:
  - Wenn `metadata.purchase_type=b2b_license` → RPC `provision_org_license_from_order(order_id, org_id, product_id, seats, valid_months)` aufrufen statt `grant_learner_course_access`
  - RPC legt Row in `org_licenses` an (seats_total, valid_until, source_ref=order_id)
- Audit-Event `b2b_license_provisioned` in `auto_heal_log`

### Welle 2 — Mitarbeiter-Einladungen (Backend + Edge)

**Tabellen:**
- `org_invitations` (id, org_id, email, role, invited_by, token UNIQUE, status: pending|accepted|revoked|expired, expires_at, accepted_by_user_id, created_at)
- Magic-Link-Token (32-byte random hex)

**RPCs:**
- `create_org_invitation(org_id, email, role)` — manager-gated, returnt token + invite-URL
- `bulk_create_org_invitations(org_id, emails[], role)` — bulk
- `revoke_org_invitation(invitation_id)`
- `accept_org_invitation(token)` — authenticated user: legt `org_memberships`-Row an + markiert invitation accepted

**Edge `send-org-invitation-email`:** ruft Lovable-Email-Queue mit branded Template (kommt mit Welle 6 falls Mail-Infra fehlt — sonst fallback: Token im UI kopieren).

**Public Route:** `/org/einladung/:token` — wenn unauth: Signup-Form → nach Signup `accept_org_invitation`. Wenn auth: One-Click-Accept.

### Welle 3 — Rollen-Zuweisung & Seat-Assignment UI

**Premium UI Page `/app/org/team`:**
- Header mit Org-Name, Seat-Counter (used/total), "Mitarbeiter einladen" CTA
- 3 Tabs: **Aktive Mitarbeiter** | **Offene Einladungen** | **Seats & Lizenzen**
- Mitarbeiter-Tabelle: Avatar, Name, Email, Rolle-Dropdown (learner/teacher/manager/admin), zugewiesene Kurse (Badge-Liste), "Entfernen"
- Bulk-Select: "Rolle ändern für N", "Seat für Kurs X zuweisen für N"
- Inline-Edit für Rolle via `update_org_member_role` RPC
- Seat-Assignment-Drawer: Multi-Select Mitarbeiter + Multi-Select Lizenzen → ruft `assign_org_license_seat` in batch

**Einladungs-Modal:**
- Tabs Single | Bulk (CSV-Paste oder Textarea mit Komma/Newline-Trennung)
- Rolle-Picker, optional initiale Kurs-Zuweisung
- Nach Submit: Liste der erzeugten Tokens mit Copy-Link-Button

### Welle 4 — Premium UX Polish gesamtes Org-Backend

**Konsistente Premium-Sprache** für alle bestehenden Org-Seiten (`/app/org`, `/app/org/team`, `/app/org/licenses`, `/app/org/audit`):
- Shared `OrgConsoleShell` Layout: SideNav, Breadcrumb, Org-Switcher (wenn user mehrere Orgs hat)
- KPI-Cards mit `shadow-elev-2`, Motion-Foundation v3 (stagger-in)
- Lade-Skeletons statt Spinner
- Empty-States mit Illustration + CTA
- Status-Badges via Design-System v2 Tokens (status-bg-subtle)
- Tabellen mit Sticky-Header, Hover-Highlight, Row-Actions im Hover
- Toasts für jede Mutation
- Confirm-Dialog für destruktive Aktionen (Seat revoke, Member remove, Invitation revoke)

### Welle 5 — RLS-Verifikation & Härtung

- Audit aller relevanten Tabellen: `orders`, `org_licenses`, `org_license_seats`, `org_memberships`, `org_invitations`, `learner_course_grants`
- Sicherstellen:
  - Org-Manager sieht **nur** Orders mit `org_id = seine Org` (RLS-Policy)
  - Mitarbeiter sieht **nur** eigene `learner_course_grants` + Grants seiner Org (über `seat_id`-Join)
  - Invitations: nur Manager seiner Org lesen/schreiben
- Helper `is_org_manager(user_id, org_id)` SECURITY DEFINER falls noch nicht existent
- Linter-Check nach Migration

### Welle 6 — End-to-End-Wiring & Smoke

- DevRoleSwitcher: Quicklink "Org-Team" + "Org-Lizenzen" hinzufügen
- Routes in `App.tsx` registrieren
- README-Notiz in `.lovable/memory/features/` (B2B Org Console v1)
- Manueller Smoke-Test-Pfad dokumentieren

---

## Technische Notizen

- **Keine neuen parallelen Systeme** (Continuity Guard #3): Wiederverwendung von `org_memberships`, `org_licenses`, `org_license_seats`, `assign_org_license_seat`, `release_org_license_seat`
- **Audit Pflicht** via `fn_emit_audit` mit registrierten action_types: `b2b_license_provisioned`, `org_invitation_created`, `org_invitation_accepted`, `org_invitation_revoked`, `org_member_role_changed`
- **GRANTs Pflicht** für alle neuen Tabellen (`org_invitations`)
- **Trigger** zum Auto-Expire von Invitations nach 14 Tagen via Cron oder lazy bei Read

## Risiken

- Stripe-Webhook-Branch könnte bestehende B2C-Smoke-Tests brechen → strikt auf `metadata.purchase_type=b2b_license` filtern
- `assign_org_license_seat` existiert bereits → wiederverwenden, nicht neu bauen
- Email-Versand: falls Email-Infra fehlt, Fallback auf Copy-Link UI (kein Blocker)

## Reihenfolge der Ausführung

1. Migration: `org_invitations` + RPCs + RLS + `provision_org_license_from_order` + audit-contracts
2. Edge Functions: `create-product-checkout` Erweiterung, `accept-org-invitation`, `send-org-invitation-email`
3. UI: `OrgConsoleShell`, `/app/org/team`, Invite-Modal, Seat-Drawer, Accept-Page
4. Polish bestehender Org-Seiten
5. RLS-Audit + Linter
6. DevRoleSwitcher + Routes + Memory

Bestätige bitte den Plan, dann starte ich mit Welle 1 (Migration).
