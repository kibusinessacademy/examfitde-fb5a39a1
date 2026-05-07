---
name: Heal Action Whitelist + Forensic Runner v1
description: heal_action_registry SSOT für admin_recommend_queue_actions/admin_execute_recommended_action; admin_get_forensic_audit_summary/_detail/admin_repair_forensic_drift für 3 Drift-Klassen; ForensicAuditRunnerCard im HealHub mit P0-Toast und CSV/JSON-Export
type: feature
---
Phase 1 (Sicherheit zuerst): heal_action_registry mit 9 unterstützten Action-Keys.
admin_recommend_queue_actions joined hart auf Registry → kein heal_other mehr.
admin_execute_recommended_action resolved Cluster über Registry; unbekannte Keys → unsupported_action + auto_heal_log Audit.
QueueActionCockpit Hard-Guard: is_executable=false ODER UNSAFE_KEYS → "Keine sichere Aktion verfügbar".

Phase 2: 3 Drift-Klassen (queued_no_jobs, ssot_step_drift, stale_processing).
RPCs admin_get_forensic_audit_summary / _detail(p_class,p_limit) / admin_repair_forensic_drift(p_class,p_dry_run,p_cap default 10, max 50).
Repair-Pfade: enqueue fehlende Jobs (queued_no_jobs), korrigiere Step-Status auf SSOT (ssot_step_drift), markiere stale processing als failed.
Audit: jeder Lauf in auto_heal_log action_type='forensic_drift_repair' mit Details.

Phase 3+4: ForensicAuditRunnerCard im HealCockpitTabContent ganz oben (zwischen MorningBriefing und LxiPublishBlockMonitorCard).
Summary-Buttons (3 Klassen) mit Severity P0/P1/P2/info, Tab-Detail mit Top 50 + CSV/JSON-Export, Cap-Input + Dry-Run/Repair-Buttons.
P0-Toast (sonner) feuert je Klasse+Bucket einmal — In-App Alarmierung ohne externe Abhängigkeit.
