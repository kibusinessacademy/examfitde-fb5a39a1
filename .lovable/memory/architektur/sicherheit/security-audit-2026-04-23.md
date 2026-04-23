---
name: security-audit-2026-04-23
description: Pentest 2026-04-23 — anon-pentest + erweiterter Pentest (OWASP API Top 10) PASSED. 276 SECDEF-View-Linter-Errors sind risikofrei (keine an anon/authenticated granted).
type: feature
---

**Audit-Stand 2026-04-23:**
- `scripts/security/anon-pentest.mjs` ist Defensive-Regression-Gate, MUSS PASSEN.
- `scripts/security/extended-pentest.mjs` ergänzt OWASP API Top 10 (IDOR, Mass-Assignment, JWT-Tampering, RPC-Fuzz, Function-Enum, CORS, Open-Redirect, Mass-Insert, Storage, Realtime). Beide Skripte sind Pre-Deploy-Gates.
- Die 276 Linter-Errors „Security Definer View" sind faktisch risikofrei: SQL-Audit zeigt 0 Grants an `anon` oder `authenticated` für die ~199 Definer-Views. Vorgehen via `.lovable/security/security-definer-views-audit-plan-v1.md` (Phase A risikofrei, Phase C reine Doku).
- Heal-Cockpit Phase 2: `/admin/heal-cockpit/package/:packageId` mit `PackageDiagnostics`-Komponente (Root-Cause, Live-Queue, Reports, Snapshots/Rollback, Limit-Guard).

**Pflicht:** Bei jedem nicht-trivialen DB-/Edge-Function-Change beide Pentest-Skripte erneut laufen lassen.
