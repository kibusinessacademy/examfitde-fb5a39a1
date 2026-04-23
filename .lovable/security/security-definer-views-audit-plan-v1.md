# Security Definer Views — Audit & Konversionsplan

**Stand:** 2026-04-23  
**Linter-Befund:** 276 ERROR `0010_security_definer_view`  
**DB-Realität:** 198 Views ohne `security_invoker`-Option + 1 mit `=true`-Schreibweise + ggf. View-Chains die auf SECDEF-Funktionen lesen → Linter zählt 276.

---

## 🟢 Kernbefund: Faktisches Risiko ist NULL

Eine direkte Abfrage von `information_schema.role_table_grants` belegt:

```sql
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND grantee IN ('anon','authenticated')
  AND privilege_type='SELECT'
  AND table_name IN (<liste der 199 definer-views>);

→ 0 Zeilen
```

**Keine** der DEFINER-Views ist für `anon` oder `authenticated` lesbar. Sie sind ausschließlich über `service_role` (Edge Functions / Admin-RPCs) zugänglich. Das bedeutet:

- ❌ Kein Datenleck zu nicht-eingeloggten Besuchern.
- ❌ Kein Privilege-Escalation-Vektor durch reguläre User.
- ✅ Der Linter-Befund ist eine **Defense-in-Depth-Empfehlung**, kein aktiver CVE.

---

## 📊 Inventar nach Risikoklasse

| Bucket             | Anzahl | Konversion empfohlen?                  | Risiko bei Conversion              |
| ------------------ | ------ | -------------------------------------- | ---------------------------------- |
| `1_admin_only` (`v_admin_*`, `admin_*`)        | 24     | ❌ Behalten als DEFINER (gerechtfertigt) | Admin-Logik bricht (RLS/Recursion) |
| `2_ops_only` (`ops_*`)                          | 66     | ⚠️ Selektiv konvertieren                | Manche aggregieren über Tabellen mit RLS, die Service-Role braucht |
| `3_audit_only` (`v_audit_*`)                    | 2      | ❌ Behalten — Audit darf RLS umgehen    | Audit-Trail bricht ohne SECDEF     |
| `5_public_safe` (`*_safe`, `*_sanitized`)       | 2      | ✅ Sofort konvertieren                  | Niedrig — Views sind explizit „safe"-suffixed und sollen RLS durchsetzen |
| `6_public_read` (`v_homepage_*`, `v_berufe_public_*`, `v_full_course_catalog`) | 2 | ✅ Sofort konvertieren | Mittel — diese sollen via RLS durchschlagen |
| `7_admin_dashboard` (1 Übrig in dieser Klasse)  | 1      | ❌ Behalten                             | Dashboard bricht                  |
| `9_misc` (uncodifizierte v_*-Views)             | 101    | 🔍 Manuell prüfen (Phase B)             | Variabel                          |

---

## 🎯 Empfohlener Vorgehensplan (3 Phasen)

### **Phase A — Sofort konvertieren (5 Views, ~5 Min)**

Diese Views haben "safe"/"public" im Namen → sollen RLS-konform sein:

| View                          | Aktion                                                   |
| ----------------------------- | -------------------------------------------------------- |
| `affiliate_referrals_safe`    | `ALTER VIEW … SET (security_invoker = on);`              |
| `companies_safe`              | dito                                                     |
| `exam_questions_safe`         | dito + RLS auf zugrundeliegender Tabelle prüfen          |
| `v_exam_questions_sanitized`  | dito                                                     |
| `v_berufe_public_safe`        | dito                                                     |
| `v_homepage_course_catalog`   | dito                                                     |
| `v_full_course_catalog`       | dito                                                     |

**Risiko:** Niedrig. Bei Bruch fallen anonyme Besucher auf eine RLS-Policy zurück (oder bekommen Zugriff verweigert). Wird durch Smoke-Test abgedeckt.

### **Phase B — Selektive Conversion (≈30 Views, ~30 Min)**

`misc_v` + nicht-kritische `ops_*`-Views, die nur lesend aggregieren und keine SECDEF-Funktionen aufrufen. Liste wird via Skript aus `pg_get_viewdef()` extrahiert: Views ohne SECDEF-Funktions-Calls → konvertierbar.

### **Phase C — Bewusste Ausnahmen dokumentieren (verbleibende ~163 Views)**

Admin-, Ops-, Audit-Views bleiben als DEFINER und werden in `mem://architektur/sicherheit/security-definer-view-exceptions-v1.md` als gerechtfertigt dokumentiert. Der Linter-Befund wird per `security--manage_security_finding` (operation: `ignore`) markiert mit dieser Begründung.

---

## ✅ Verifikations-Skript (nach jeder Phase)

```bash
node scripts/security/anon-pentest.mjs       # 0 Findings erwartet
node scripts/security/abuse-simulation.mjs   # 0 Findings erwartet
node scripts/security/secdef-audit.mjs       # zeigt verbleibende DEFINER-Views
```

---

## 🚦 Freigabe-Anforderung

Bitte freigeben:

- [ ] **Phase A**: 5–7 `*_safe`/`public_*`-Views automatisch auf `security_invoker = on` umstellen.
- [ ] **Phase B**: Selektive Conversion nach Skript-basierter Analyse (Liste wird vor Conversion vorgelegt).
- [ ] **Phase C**: Die 163 Admin-/Ops-/Audit-Views als „gerechtfertigte Ausnahme" markieren (Memory + Finding-Ignore).

Phase A ist quasi risikofrei; Phase B braucht ein 5-Min-Vorlage-Review; Phase C ist Doku-Arbeit.
