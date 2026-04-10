# Memory: architektur/ops/ops-forensic-report-system-v1
Updated: 2026-04-10

Das 'Ops Forensic Report' System erzeugt strukturierte, kausale Diagnosen für Pipeline-Anomalien. Es ersetzt rein symptomatische Fehlerlisten durch eine forensische Schicht, die Ursachen von Folgeproblemen trennt.

## Architektur

### Tabellen
- `ops_forensic_reports`: Hauptbericht pro Package mit Root-Cause-Klassifikation, Kausalkette, Healability-Assessment und empfohlenen Aktionen.
- `ops_forensic_findings`: Einzelbefunde (symptom, root_cause, supporting_evidence, recommendation) pro Bericht.
- `step_job_mapping`: SSOT-Tabelle für Step→Job-Type Zuordnung. Ersetzt den fragilen `LIKE '%' || step_key || '%'` Pattern vollständig.

### Root-Cause-Taxonomie (feste Klassen)
NO_SOURCE_BLUEPRINTS, MAPPING_MISMATCH, UPSTREAM_VARIANTS_MISSING, PROMOTION_WRITE_FAILED, POSTCONDITION_FALSE_NEGATIVE, STALE_LOCK_FALSE_ACTIVE, WORKER_POOL_MISMATCH, QUEUE_POLICY_MISMATCH, PAYLOAD_CONTRACT_MISMATCH, DUPLICATE_ORPHAN_PROCESSING, FALSE_FINALIZATION, MATERIALIZATION_GUARD_BLOCK, GOVERNANCE_BLOCK, QUALITY_GATE_BLOCK, ACCESS_OR_ENTITLEMENT_BLOCK, UNKNOWN_NEEDS_MANUAL_REVIEW

### Healability Assessment (gehärtet)
- `auto_healable`: technisch recoverbar, keine Governance-Verletzung, kein fehlendes Upstream-Artefakt, kein strukturelles Root-Cause-Problem
- `manual_review`: Publish/Council/Governance betroffen ODER stale Jobs bei gleichzeitigem Upstream-/Governance-Block
- `hard_blocked`: essentielle SSOT fehlt, Qualitätsgrenze aktiv
- `unknown`: nicht klassifizierbar

### Auto-Heal-Bedingungen (alle müssen erfüllt sein)
1. Stale Jobs vorhanden
2. Kein Governance Block (status != 'blocked', kein blocked_reason)
3. Kein fehlendes Upstream-Artefakt (has_missing_upstream = false)
4. Kein terminal gate_class

### RPC
- `fn_generate_package_forensic_report(p_package_id)`: Erzeugt vollständigen Bericht, superseded vorherige offene Reports.
- `fn_get_jobs_for_step(p_package_id, p_step_key)`: Gibt Jobs für einen Step via `step_job_mapping` zurück.

### Views
- `ops_open_forensic_reports`, `ops_auto_healable_reports`, `ops_hard_blocked_reports`
- `ops_exam_pool_promotion_blocked`: Packages mit generate_exam_pool blocked wegen fehlendem promoted artifact

### UI
- `/admin/forensics` — Forensic Reports Page mit List/Detail/Tabs (Diagnose, Findings, Kausalkette, Steps, Jobs, Aktionen)
- Filter nach Healability und Root Cause
- Root-Cause-Badges mit lesbaren Labels
- Findings-Tab rendert strukturierte Einzelbefunde mit Severity-Badges

## Kritischer Fix: artifact-resolver.ts Track-Aware Härtung
Die `artifactExists()` Funktion prüft jetzt explizit via `getSkippedSteps(track)` ob ein fehlender Producer-Step fachlich zum Track gehört. Nur wenn der Step vom Track übersprungen wird (z.B. `promote_blueprint_variants` nicht im EXAM_FIRST Track), gilt das Artefakt als erfüllt. Fehlt ein Step der eigentlich im Track sein sollte, wird ein INTEGRITY-Warning geloggt und `false` zurückgegeben. Dies verhindert, dass kaputte `package_steps`-Zustände still als "erfüllt" durchrutschen.
