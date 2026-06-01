---
name: B2B Org Console Premium v1
description: Vollständige Unternehmens-Konsole unter /app/org/:orgId mit Team-, Lizenz-, Einladungs- und Aktivitäts-UI. Reused alle bestehenden Org-Tables/RPCs, plus 4 neue Helper-RPCs für Member-/Invite-Listen und Rollen-Updates.
type: feature
---

## SSOT

- **Pages:** `src/pages/app/org/` (Layout, Dashboard, Team, Licenses, Invites, Activity) + `src/pages/org/OrgInviteAcceptPage.tsx` (public `/org/einladung/:token`)
- **Hooks:** `src/hooks/useOrgConsoleData.ts` (Members, Invites, Role-Update, Invite-Revoke, Remove-Member); reuses `useOrgDashboard`, `useOrgConsole`
- **API:** `src/lib/orgConsoleApi.ts` thin RPC wrappers
- **Dialogs:** `src/components/org/InviteMemberDialog.tsx` (single + bulk)
- **Routes:** registered in `src/routes/AppRoutes.tsx` unter `<ProtectedRoute>` + public `/org/einladung/:token`

## Neue RPCs (manager-gated, SECURITY DEFINER)

- `list_org_members(org_id)` — Members + Profile-Daten + seats_count
- `list_org_invites(org_id)` — Einladungen + product_title
- `update_org_member_role(org_id, user_id, new_role)` — Owner/Admin only; schützt letzten Owner; nur Owner kann Owner promoten; Audit `org_member_role_changed`
- `revoke_org_invite(invite_id)` — Manager+

## Bestehende Pipeline (unverändert)

- **B2B-Checkout** (`create-b2b-checkout` + `stripe-webhook` Branch line 504+): `org_id` Metadaten → `org_licenses` + Auto-Seat für Käufer
- **Invite-Erstellung:** `create_org_license_invite` (capacity-checked, idempotent)
- **Invite-Annahme:** `accept_org_license_invite` (Seat-Assign + Membership-Insert)
- **Seat-Mgmt:** `assign_org_license_seat` / `release_org_license_seat`

## RLS-Status

- `org_license_invites`: Org-Admins/Manager INSERT+SELECT (policies vorhanden)
- `org_memberships`: User sieht eigene Memberships
- `org_license_seats`: Org-Admins/Manager manage (policy vorhanden)
- `org_licenses`: Org-Members sehen ihre Lizenz
- Alle neuen RPCs: `is_org_member_with_role(auth.uid(), org_id, ARRAY['owner','admin','manager'])` Gate

## Audit-Contract

`org_member_role_changed` mit required_keys `org_id, user_id, old_role, new_role`.

## Anti-Drift

- Keine neuen Tabellen (Continuity Guard #3: NO_PARALLEL_SYSTEMS) — reuses `org_memberships`, `org_licenses`, `org_license_seats`, `org_license_invites`.
- Default-Rolle in UI = `learner`; UI bietet learner/manager/admin (never `member` — würde org_memberships_role_check brechen).
