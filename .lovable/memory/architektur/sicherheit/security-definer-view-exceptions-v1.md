---
name: security-definer-view-exceptions-v1
description: 198 SECURITY DEFINER Views in public sind gerechtfertigte Ausnahmen — 0× anon/PUBLIC, 0× authenticated Grant. Nur service_role. Linter-Befund (276) ist Defense-in-Depth-Empfehlung, kein aktiver CVE. Conversion nur bei echten Public-Catalog-Views nach Dependency-Review.
type: constraint
---

**Kanonisches Audit:** `docs/security/SECURITY_DEFINER_VIEW_AUDIT_PLAN.md`

**Inventar (2026-04-24):**
- 198 DEFINER-Views in `public` — Klassifizierung: 0× P0, 0× P1, 116× P2_admin, 82× P3.
- Grant-Matrix: ausschließlich `service_role` — kein anon/authenticated/PUBLIC.
- Folge: Kein Public-Leak, kein Privilege-Escalation-Vektor durch reguläre User.

**Regel:**
1. **Keine Massenkonvertierung** auf `security_invoker=on`. Bricht Admin-RLS, KPI-Views, Heal-Cockpit.
2. **Conversion nur** wenn alle gelten:
   - View ist explizit für anon/auth gedacht (Naming `*_safe`, `*_public`, `v_homepage_*`, `v_full_course_catalog`).
   - Grant existiert oder soll existieren.
   - Underlying-Tables haben funktionierende RLS für anon/auth.
   - `anon-pentest.mjs` + `extended-pentest.mjs` PASS nach Conversion.
3. **Vor jeder Conversion** Dependency-Map konsultieren: `/mnt/documents/security/secdef-views-dependency-map.json`.
4. **Linter-Findings** (276 ERROR `0010_security_definer_view`) sind als „gerechtfertigt" markiert — service_role-only Zugriff, dokumentiert.

**Re-Audit-Trigger:** Wenn neue View mit Grant an anon/authenticated angelegt wird → automatisch P0/P1 → Sofort-Review.

**Pflicht-Skripte:**
```bash
node scripts/security/anon-pentest.mjs
node scripts/security/extended-pentest.mjs
node scripts/security/secdef-audit.mjs
```
