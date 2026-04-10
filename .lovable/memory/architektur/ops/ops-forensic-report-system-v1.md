# Memory: architektur/ops/ops-forensic-report-system-v1
Updated: 2026-04-10

Das 'Ops Forensic Report' System erzeugt strukturierte, kausale Diagnosen für Pipeline-Anomalien. Es ersetzt rein symptomatische Fehlerlisten durch eine forensische Schicht, die Ursachen von Folgeproblemen trennt.

## Architektur

### Tabellen
- `ops_forensic_reports`: Hauptbericht pro Package mit Root-Cause-Klassifikation, Kausalkette, Healability-Assessment und empfohlenen Aktionen.
- `ops_forensic_findings`: Einzelbefunde (symptom, root_cause, supporting_evidence, recommendation) pro Bericht.

### Root-Cause-Taxonomie (feste Klassen)
NO_SOURCE_BLUEPRINTS, MAPPING_MISMATCH, UPSTREAM_VARIANTS_MISSING, PROMOTION_WRITE_FAILED, POSTCONDITION_FALSE_NEGATIVE, STALE_LOCK_FALSE_ACTIVE, WORKER_POOL_MISMATCH, QUEUE_POLICY_MISMATCH, PAYLOAD_CONTRACT_MISMATCH, DUPLICATE_ORPHAN_PROCESSING, FALSE_FINALIZATION, MATERIALIZATION_GUARD_BLOCK, GOVERNANCE_BLOCK, QUALITY_GATE_BLOCK, ACCESS_OR_ENTITLEMENT_BLOCK, UNKNOWN_NEEDS_MANUAL_REVIEW

### Healability Assessment
- `auto_healable`: technisch recoverbar, keine Governance-Verletzung
- `manual_review`: Publish/Council/Governance betroffen
- `hard_blocked`: essentielle SSOT fehlt, Qualitätsgrenze aktiv
- `unknown`: nicht klassifizierbar

### RPC
- `fn_generate_package_forensic_report(p_package_id)`: Erzeugt vollständigen Bericht, superseded vorherige offene Reports.

### Views
- `ops_open_forensic_reports`, `ops_auto_healable_reports`, `ops_hard_blocked_reports`

### UI
- `/admin/forensics` — Forensic Reports Page mit List/Detail/Tabs (Diagnose, Kausalkette, Steps, Jobs, Aktionen)

## Kritischer Fix: artifact-resolver.ts Konsistenz
Die `artifactExists()` Funktion war inkonsistent mit `prereqDone()`: wenn ein Producer-Step nicht in `package_steps` existiert (Track enthält ihn nicht), gab `artifactExists` false zurück, während `prereqDone` korrekt true zurückgab. Dies verursachte Endlosschleifen bei `generate_exam_pool` für Pakete ohne Variant-Pipeline-Steps. Behoben durch Alignment: fehlender Producer-Step → Artefakt gilt als fulfilled.
