---
name: tail-drift-monitor-v4-obsolete-failed-jobs
description: Pattern X1 (Obsolete Failed Tail Jobs) + X2 (Terminal-Gate-Widerspruch) + Multi-Layer-Audit + Quarantäne + Pipeline-Live-View + Runbook
type: feature
---
# Tail-Drift-Monitor v4

## Pattern X1 — Obsolete Failed Tail Jobs
Tail-Steps (`run_integrity_check`,`quality_council`,`auto_publish`,`repair_exam_pool_quality`,`elite_harden`,`build_ai_tutor_index`,`validate_tutor_index`,`promote_blueprint_variants`) hängen `queued`/`pending_enqueue` >10min, weil hunderte `failed` Jobs aus älteren Pipeline-Phasen (`package_run_integrity_check`,`package_quality_council`,`package_generate_exam_pool`,`package_validate_exam_pool`,`package_repair_exam_pool_quality`) den DAG-Picker blockieren — obwohl ≥50 approved Fragen vorliegen.

**Heal:** `fn_detect_obsolete_failed_tail_jobs(dry_run, debug)` cancelt obsolete failed Jobs (älter 30min) + clear `last_atomic_enqueue_at` debounce.
**Cron:** `tail-obsolete-failed-jobs-cleanup-10min` (*/10 * * * *).

## Pattern X2 — Terminal-Gate-Widerspruch
`gate_class='terminal'` aber `status='building'` mit ≥50 approved Q. Erzeugt Deadlock weil Gate Publish blockt aber Pipeline weiterläuft.

**Heal:** `fn_quarantine_terminal_gate_conflicts` legt Eintrag in `package_quarantine` an. Manuelles Review nötig.
**Cron:** `gate-conflict-quarantine-30min`.

## Multi-Layer-Audit
Tabelle `heal_audit_layers` mit 5 Ebenen (Symptom/Step/DAG/Gate/Artifact) before+after JSON. RPC `admin_get_heal_audit_layers(package_id?, limit)`. Helper `fn_snapshot_package_layers(uuid)` SECURITY DEFINER.

## Live View
View `v_package_pipeline_live` (REVOKE PUBLIC, GRANT service_role). RPC `admin_get_package_pipeline_live(package_id?, limit)` mit has_role-Gate. UI: PackagePipelineLiveCard (15s refresh) + HealAuditLayersCard.

## Debug-Mode Drift-Detector
`fn_detect_obsolete_failed_tail_jobs(_, debug:=true)` liefert pro Paket: predecessors_done, tail_blocked (mit Alter), matched_features. Geschrieben in `auto_heal_log.metadata.debug`.

## Runbook
`docs/runbooks/manual-bypass-tail-phase.md` — Forensik-Checkliste, sichere Bypass-Strategien (Anti-Pattern: `started_at`-Manipulation), Cron-Coverage-Tabelle.

## Bewiesen 2026-05-02
- 25+ Pakete mit obsolete failed jobs identifiziert (Top: BWL Bachelor 166, Glasapparatebauer 74, Versicherungsvermittler 50)
- 4 Pakete in Quarantäne wegen Pattern X2 (Bankfachwirt, Datenschutz TÜV, Versicherungsvermittler, Finanzanlagen)
- 47 Multi-Layer-Audit-Rows beim ersten Lauf erzeugt
