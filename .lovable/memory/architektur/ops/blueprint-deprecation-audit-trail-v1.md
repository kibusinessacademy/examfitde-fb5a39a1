---
name: Blueprint Deprecation Audit Trail v1
description: blueprint_audit_log mit reactivated/wave_revoked Aktionen, Auto-Trigger fn_audit_blueprint_status_change, Backfill der WAVE15A-Historie und Per-Paket-View v_blueprint_audit_per_package für Admin Review-UI.
type: feature
---

## Überblick

Jede Statusänderung an `question_blueprints` wird jetzt automatisch in `blueprint_audit_log` protokolliert — mit Welle, Quelle und Reaktivierungs-Marker.

## Schema

`blueprint_audit_log.action` erlaubt jetzt:
`created | updated | approved | deprecated | reactivated | wave_revoked | variant_generated`

`blueprint_audit_log.changes` (jsonb) enthält:
- `wave`: WAVE15A | WAVE15A_REVIVAL | MANUAL_HEAL | ROLLBACK | AD_HOC
- `old_status`, `new_status`
- `curriculum_id`, `competency_id`

## Trigger

`trg_audit_blueprint_status_change` (AFTER INSERT OR UPDATE OF status) → `fn_audit_blueprint_status_change` (SECURITY DEFINER):
- `OLD.status='deprecated' AND NEW.status='approved'` → action=`reactivated`
- `NEW.status='deprecated'` → action=`deprecated`
- alles andere → `approved` / `updated`

## View

`v_blueprint_audit_per_package` joined `blueprint_audit_log → question_blueprints → course_packages` und liefert pro Paket sämtliche Deprecation-/Reactivation-Events. Wird von `IntegrityExplainTabContent` (Cockpit-Tab `explain`) konsumiert.

## UI

`/admin/queue?tab=explain` rendert pro Paket:
- Aktive Guards + Re-Trigger-Buttons
- Audit-Marker (admin_actions)
- Blueprint Deprecation Audit (per BP: Wave + Reaktivieren/Re-Deprecate)
