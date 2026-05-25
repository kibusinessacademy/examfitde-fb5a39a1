---
name: Berufs-KI Phase 5 Workflow Learning Engine
description: Cluster-Engine, Blueprint-Kandidaten, Submitter-Notifications und Materialization. Selbstverbessernder Berufs-KI Intelligenz-Layer (governance-first).
type: feature
---
# Phase 5 — Workflow Learning Engine

## Tabellen
- `berufs_ki_workflow_clusters` — Mustercluster (Signatur category|beruf|curriculum), submission_ids, output_section_refs, common_patterns, merge_confidence, status (detected|reviewing|promoted|dismissed), promoted_candidate_id.
- `berufs_ki_blueprint_candidates` — aus Cluster geförderte Blueprint-Vorschläge mit suggested_input/output_schema, confidence_score, review_status (proposed|approved|rejected|materialized), materialized_definition_id.
- `berufs_ki_submitter_notifications` — pro Empfänger RLS-geschützte Inbox; event_type ∈ {submission_received, precheck_done, approved, approved_with_edits, needs_changes, rejected, merged_into_official, became_blueprint_candidate, blueprint_materialized}.

## Definitions-Erweiterung
`berufs_ki_workflow_definitions.workflow_class` ∈ {official, community_verified, blueprint_materialized, experimental} + `source_submission_id` + `source_cluster_id`.

## RPCs (admin / has_role)
- `admin_berufs_ki_recompute_clusters(_min_size=3)` — gruppiert über approved/under_review Submissions, UPSERT nach cluster_signature.
- `admin_berufs_ki_list_clusters(_status, _limit)`.
- `admin_berufs_ki_promote_cluster_to_blueprint_candidate(_cluster_id, _title, _description)` — erstellt Kandidat + setzt cluster.status=promoted + benachrichtigt alle Beitragenden (event=became_blueprint_candidate).
- `admin_berufs_ki_list_blueprint_candidates(_status, _limit)`.
- `admin_berufs_ki_materialize_blueprint_candidate(_candidate_id, _slug, _system_prompt, _user_prompt_template, _tier='pro')` — INSERT into definitions mit workflow_class=blueprint_materialized, benachrichtigt Beitragende (event=blueprint_materialized).

## RPCs (learner)
- `learner_berufs_ki_list_my_notifications(_limit)`
- `learner_berufs_ki_mark_notification_read(_id)`
- `learner_berufs_ki_list_my_submissions(_limit)`

## Trigger
`trg_bki_notify_on_submission` (AFTER INSERT OR UPDATE OF status) → schreibt automatisch Submitter-Notifications (received / precheck_done / approved / approved_with_edits / needs_changes / rejected).

## UI
- `/admin/berufs-ki/learning` (BerufsKILearningPage) — Tabs Cluster + Blueprint-Kandidaten, Recompute-Button, Promote-Dialog, Materialize-Dialog (slug/system/user prompt/tier).
- `/berufs-ki/inbox` (BerufsKIInboxPage) — Submitter-Inbox: Notifications + Meine Submissions, mark-as-read.

## Governance-Prinzip
Keine autonomen Production-Writes: Cluster → Kandidat → Definition jeweils mit explizitem Admin-Trigger; Beitragende werden bei jedem Promotion-Schritt benachrichtigt.
