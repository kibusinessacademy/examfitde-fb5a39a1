---
name: LXI Phase-2 Effective Hard-Block (matrix-aware)
description: Publish-Guard prüft jetzt auch gate_no_minichecks_effective, gate_no_oral_effective, gate_no_tutor_context_effective via Applicability-Matrix. Audit lxi_publish_blocked_effective. Monitoring via admin_get_lxi_publish_block_summary + LxiPublishBlockMonitorCard im Heal-Cockpit.
type: feature
---

## Stand 2026-05-06

- `fn_guard_publish_lxi_no_lessons` erweitert: liest `v_learning_integrity_audit` (lessons) UND `v_learning_gate_track_aware` (effective gates). Block bei beliebigem true-Gate.
- Audit: `auto_heal_log.action_type='lxi_publish_blocked_effective'`, metadata={track, violations[], attempted_status, previous_status}.
- Already-published Pakete unangetastet (kein Demote).
- Safety-Check vor Aktivierung 0/0/0 published violations.
- Monitoring:
  - `v_lxi_publish_block_monitor` (7d, hour-bucket × track × gate, service_role only)
  - RPC `admin_get_lxi_publish_block_summary(p_hours)` → {total, by_track, by_gate, top_clusters[10], trend_hourly}
  - RPC `admin_get_lxi_publish_block_events(p_hours, p_limit)` → Detail-Drilldown
  - UI: `LxiPublishBlockMonitorCard` im HealCockpit (severity ok/warning/critical based on count)

## Track-Counts der jetzt geblockten potentiellen Publishes (nicht published)
- AUSBILDUNG_VOLL: 0/0/0
- STUDIUM: 31 minicheck, 0 oral, 30 tutor
- EXAM_FIRST_PLUS: 0 minicheck, 0 oral, 48 tutor
- EXAM_FIRST: 0/0/0 (alle Gates exempt)
