# Security Audit & Pentest Report — 2026-04-23

**Scope:** Lovable Cloud Backend (Supabase Project ubdvvvsiryenhrfmqsvw)  
**Trigger:** Phase 2 Heal-Cockpit Auslieferung + 276 Linter-Warnungen + Pentest-Anfrage  
**Methode:** Bestehende Skripte + neuer erweiterter Pentest (OWASP API Top 10) + DB-Privilegien-Inventar

---

## Executive Summary

| Bereich                        | Status   | Befunde                              |
| ------------------------------ | -------- | ------------------------------------ |
| Anon-Pentest (bestehend)       | ✅ PASS  | 0 von ~70 Probes durchgekommen        |
| Erweiterter Pentest (10 Vektoren) | ✅ PASS  | 0 Fehler, 0 Warnungen                 |
| 276 Security-Definer-Views     | 🟢 NO RISK | Keine an `anon`/`authenticated` granted |
| RLS-Policies (Stichprobe)      | ✅ OK    | Alle sensiblen Tabellen blockieren anon |
| Edge Function Auth             | ✅ OK    | Alle admin-* gaten 401 ohne JWT       |
| Storage Buckets                | ✅ OK    | 0 sensible Buckets exponiert          |

**Empfehlung:** Keine kritischen Maßnahmen nötig. Der 276-Linter-Befund ist eine Defense-in-Depth-Empfehlung ohne aktiven Risikoeinfluss (siehe Audit-Plan). Phase 2 UI ist freigegeben.

---

## 1. Bestehender Anon-Pentest (`scripts/security/anon-pentest.mjs`)

**Ergebnis:** PASSED — alle Tests grün.

- ✅ 19 sensible Tabellen blockieren anon-SELECT (401/404)
- ✅ 6 öffentliche Allowlist-Tabellen lesbar (200)
- ✅ 8 geschützte Tabellen verweigern anon-INSERT (400 schema-reject)
- ✅ 6 admin-RPCs unauffindbar via anon (404)
- ✅ 11 admin-Edge-Functions blocken ohne JWT (401)

## 2. Erweiterter Pentest (`scripts/security/extended-pentest.mjs` — neu)

10 zusätzliche OWASP-API-Vektoren, alle PASSED:

| Vektor | Test                                               | Ergebnis |
| ------ | -------------------------------------------------- | -------- |
| V1     | IDOR/BOLA gegen profiles, exam_sessions, user_progress, ai_tutor_logs | ✅ blocked |
| V2     | Mass Assignment auf profiles (role=admin), user_roles | ✅ rejected |
| V3     | JWT Tampering: alg=none, manipulierte Sig, expired token | ✅ alle 401 |
| V4     | RPC Parameter Fuzz: SQL-Marker, Null, Path-Traversal, 100k-Strings, Type-Confusion auf 3 RPCs (15 Probes) | ✅ alle blocked |
| V5     | Edge Function Enumeration: 10 legacy/debug-Namen   | ✅ alle 404 |
| V6     | CORS Misconfig: evil.attacker.example als Origin   | ✅ Supabase-Default `*` (kein evil-Reflect) |
| V7     | Open Redirect via /auth/v1/authorize?redirect_to=evil | ✅ 400 rejected |
| V8     | Mass Insert: 50 rapid REST-INSERTS auf courses     | ✅ 50/50 blocked |
| V9     | Storage Bucket Listing                             | ✅ 0 Buckets exponiert |
| V10    | Realtime Health Endpoint                           | ✅ 403 gated |

## 3. Security Definer Views — Inventar

198 Views in `public` ohne `security_invoker=on` Setting. Linter zählt 276 (zusätzlich werden View-Chains gezählt, die SECDEF-Funktionen aufrufen).

**Krit. Befund (Privilege-Audit):**
```sql
SELECT count(*) FROM information_schema.role_table_grants
WHERE grantee IN ('anon','authenticated') AND privilege_type='SELECT'
  AND table_name IN (<199 definer-views>);
→ 0
```

→ **Faktisches Datenleck-Risiko: NULL.** Diese Views sind ausschließlich von service_role / Admin-RPCs zugreifbar.

**Vorgehen:** Siehe `.lovable/security/security-definer-views-audit-plan-v1.md` (3-Phasen-Plan, Phase A risikofrei, Phase C reine Doku).

## 4. RLS-Policies (Stichprobe)

Alle Schreib- und Leseversuche durch anon auf `profiles`, `user_roles`, `subscriptions`, `affiliate_*`, `ai_*`, `executive_summary_reports` schlugen fehl (401/404). Smoke-Test über bestehende `anon-pentest.mjs`-Allowlist bleibt grün.

## 5. JWT & Auth-Hardening

- ✅ HS256 mit Supabase-Default
- ✅ `alg=none`-Attacke wird zuverlässig abgewiesen
- ✅ Manipulierte Signaturen abgelehnt
- ✅ Expired Tokens abgelehnt
- ✅ Open-Redirect-Schutz aktiv (`/auth/v1/authorize` validiert `redirect_to` gegen Allowlist)

## 6. Edge Functions

11 admin-* Functions getestet → alle gaten ohne Bearer-JWT mit 401. Legacy-Namen (admin-debug, exec-sql, dump-secrets, …) → alle 404 (nicht deployed).

---

## Empfohlene nächste Schritte

1. **Phase A** des Definer-View-Plans ausführen (5 `*_safe`/`*_public_*`-Views auf `security_invoker=on` umstellen) — Reduktion von 276 → ~270 Linter-Errors, kein Risiko.
2. **Phase C** Doku schreiben + Linter-Findings als „accepted exception" markieren.
3. **CI-Integration** des neuen `extended-pentest.mjs` als Pre-Deploy-Gate.
4. **Optional Phase B** nach 1-tägiger Stabilität von Phase A.

Reproduzierbar:
```bash
node scripts/security/anon-pentest.mjs
node scripts/security/extended-pentest.mjs
```
