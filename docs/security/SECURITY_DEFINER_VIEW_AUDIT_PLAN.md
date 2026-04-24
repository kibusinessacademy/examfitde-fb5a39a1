# SECURITY DEFINER View Audit Plan
**Stand:** 2026-04-24  
**Methode:** SQL-Klassifizierung + Code-Dependency-Map + Workflow-Audit  
**Status:** Inventar abgeschlossen — keine Massenkonvertierung empfohlen.

## 🟢 Kernbefund

| Metrik | Wert |
|---|---|
| DEFINER-Views (public) | **198** |
| Linter-Warnings | 276 (View-Chains zählen mehrfach) |
| **P0** (anon/PUBLIC granted) | **0** |
| **P1** (authenticated + sensitive) | **0** |
| **P2_auth** (authenticated only) | **0** |
| **P2_admin** (admin/ops only) | **116** |
| **P3** (internal/utility) | **82** |

> **Ergebnis:** Kein P0/P1. Akut kein Public-Leak. Befund ist Linter-/Governance-Thema.

## 📋 Klassifizierung

### P0 — Anon / Public Grant
Sofortige Conversion erforderlich. **Keine Treffer.** ✅

### P1 — Authenticated + Sensitive Tables
Sprint-Plan erforderlich. **Keine Treffer.** ✅

### P2_auth — Authenticated only, non-sensitive
**Keine Treffer.** ✅

### P2_admin — Admin/Ops/Audit only (116)

Behalten als DEFINER. Service-Role-only Zugriff. Beispiele Top-15 nach Code-Nutzung:

| View | Code-Refs |
|---|---|
| `ops_building_without_job_or_lease` | 8 |
| `v_admin_packages_ssot` | 8 |
| `ops_blocked_packages` | 5 |
| `ops_hollow_completion` | 5 |
| `ops_package_readiness` | 5 |
| `v_admin_heal_cockpit` | 5 |
| `ops_auto_publish_false_success` | 4 |
| `ops_blocked_but_ready` | 4 |
| `ops_build_activity_truth` | 4 |
| `ops_jobtype_step_map` | 4 |
| `ops_package_blockers` | 4 |
| `ops_pipeline_step_drift` | 4 |
| `ops_publish_eligible_but_stuck` | 4 |
| `v_admin_morning_briefing` | 4 |
| `v_admin_queue_ssot` | 4 |

### P3 — Internal/Utility (82)

Hauptkandidaten für selektive Conversion (nach Dependency-Review). Top-15:

| View | Code-Refs |
|---|---|
| `v_course_display_ssot` | 7 |
| `v_user_active_recommendations` | 6 |
| `v_user_current_readiness` | 6 |
| `v_user_top_gaps` | 6 |
| `v_pipeline_stalled_packages` | 5 |
| `v_pipeline_content_integrity` | 4 |
| `v_pipeline_error_class` | 4 |
| `v_pipeline_step_funnel` | 4 |
| `v_pipeline_stuck_processing` | 4 |
| `v_building_package_eta` | 3 |
| `v_contract_integrity_summary` | 3 |
| `v_exam_questions_safe` | 3 |
| `v_full_course_catalog` | 3 |
| `v_homepage_course_catalog` | 3 |
| `v_learner_visible_exam_simulations` | 3 |

## 🎯 Vorgehensplan

### Phase A — KEINE Massenkonvertierung
- Begründung: 0× anon/PUBLIC, 0× authenticated. Grant-Matrix bleibt service_role-only.
- Bei jeder Conversion auf `security_invoker=on` riskieren wir Admin-RLS-Recursion und KPI-Brüche.

### Phase B — Selektiv für echte Public-Catalog-Views
Nur konvertieren, wenn:
1. View ist explizit für anon/auth gedacht (Naming `*_safe`, `*_public`, `v_homepage_*`, `v_full_course_catalog`).
2. **AND** Grant existiert oder soll existieren.
3. **AND** Underlying-Tables haben funktionierende RLS-Policies für anon/auth.
4. **AND** Smoke-Tests + anon-pentest.mjs PASS.

Aktuell: keine View erfüllt (1)+(2). Phase B steht aus, bis ein Public-Use-Case entsteht.

### Phase C — Linter-Findings als „gerechtfertigt" markieren
- Per `security--manage_security_finding` operation `ignore` mit Begründung „service_role-only, kein Public Grant".
- Memory: `mem://architektur/sicherheit/security-definer-view-exceptions-v1.md`.

## 📦 Artefakte

| Datei | Zweck |
|---|---|
| `docs/security/SECURITY_DEFINER_VIEW_AUDIT_PLAN.md` | Diese Datei (canonical) |
| `/mnt/documents/security/secdef-views-classification.csv` | CSV-Export aller 198 Views mit Klassifizierung |
| `/mnt/documents/security/secdef-views-classification.json` | JSON-Pendant |
| `/mnt/documents/security/secdef-views-dependency-map.json` | View → Code-Refs Map |
| `/mnt/documents/security/github-actions-audit.json` | Workflow-Audit Findings |
| `scripts/security/secdef-audit.mjs` | Wiederholbares Audit-Skript |

## 🛠️ GitHub Actions Audit

**38 Workflows analysiert**, 38 mit Findings.

| Severity | Count |
|---|---|
| P1 | 35 |
| P2 | 131 |
| P3 | 31 |

### Häufigste Findings
- **P1 NO_PERMISSIONS** (35×): Top-level `permissions:` Block fehlt → Default `write-all` möglich. **Empfohlene Härtung:** `permissions: read-all` als Default, Job-spezifisch erweitern.
- **P2 UNPINNED_ACTION** (~131×): Actions referenzieren `@v4` statt SHA. Risiko: Tag-Repointing/Supply-Chain. Empfohlen: Dependabot pinning oder pin-github-action.
- **P3 NO_TIMEOUT** (~31×): Jobs ohne `timeout-minutes` → 6h-Default Hänger möglich.

### Sofort-Maßnahmen
1. ✅ Keine `pull_request_target` Script-Injection-Vektoren gefunden.
2. ✅ Keine hardcoded Secrets gefunden.
3. ⚠️ `permissions: read-all` als Repo-Default in Settings setzen (außerhalb Code).
4. ⚠️ Action-Pinning per Renovate/Dependabot policy (Issue separat).

## ✅ Verifikation
```bash
node scripts/security/anon-pentest.mjs       # 0 Findings
node scripts/security/extended-pentest.mjs   # 0 Findings
node scripts/security/secdef-audit.mjs       # HIGH=0
```