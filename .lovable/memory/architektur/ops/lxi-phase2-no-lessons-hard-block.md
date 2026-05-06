---
name: LXI Phase 2 — gate_no_lessons Hard-Block + track-aware Kalibrierung
description: Track-aware gate_no_lessons (false für EXAM_FIRST/_PLUS), BEFORE-Trigger trg_guard_publish_lxi_no_lessons blockt Publish, kein Demote. Audit v_lxi_no_lessons_report per Track. Andere Gates bleiben warning-only.
type: feature
---

## Stand 2026-05-06

- View `v_learning_integrity_audit`: `gate_no_lessons = (lesson_count=0 AND track NOT IN ('EXAM_FIRST','EXAM_FIRST_PLUS'))`. Track-Spalte exposed.
- Trigger `trg_guard_publish_lxi_no_lessons` BEFORE INSERT OR UPDATE OF status: blockt Publish-Übergang (kein Demote, already-published unangetastet). Audit `auto_heal_log.action_type='lxi_publish_blocked'`.
- Dispatcher `admin_dispatch_lxi_no_lessons_repair` mit Skip-Reason `LESSONS_NOT_APPLICABLE_FOR_TRACK` als Defense-in-Depth.
- Report-View `v_lxi_no_lessons_report` + RPC `admin_get_lxi_no_lessons_report` (per track: published_total, still_no_lessons, no_lessons_but_not_applicable, avg_score, last_block_at, last_repair_enqueued_at, blocks_24h).
- Baseline: 66 published — 0 violators · EXAM_FIRST 44 (9 not_applicable), EXAM_FIRST_PLUS 8 (2 not_applicable), AUSBILDUNG_VOLL 14, STUDIUM 0.

## Lesson Learned
- Erstes "Repair alle (11)" cancelled von `trg_guard_ssot_applicability` (Track-Mismatch). Daraus: Gates müssen track-aware kalibriert sein, BEVOR Hard-Block aktiv wird.
- `gate_no_minichecks`, `gate_no_oral`, Coverage-Gates bleiben warning-only — eigene Applicability-Kalibrierung pro Gate notwendig.
