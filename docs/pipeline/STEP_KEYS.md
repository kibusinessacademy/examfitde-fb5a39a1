# STEP_KEYS (SSOT)

This file is the **Single Source of Truth** for pipeline step keys (`package_steps.step_key`).

## Rules
- Add new step keys here first.
- Never hardcode step keys scattered across the repo.
- All job-runner graphs must reference these keys.
- The Pipeline Contract Guard CI check validates this file exists.

## step_key list

### Core Pipeline (AUSBILDUNG_VOLL – 20 steps)
- `enrich_curriculum` — Curriculum enrichment with BIBB/Verordnung data
- `scaffold_learning_course` — Create lesson structure from curriculum
- `generate_learning_content` — AI-generated lesson content
- `generate_minichecks` — Mini-quiz generation per lesson
- `generate_handbook` — Comprehensive study handbook
- `generate_exam_blueprints` — Exam question blueprints from curriculum
- `generate_exam_pool` — Full exam question generation from blueprints
- `validate_exam_questions` — AI quality validation of exam questions
- `generate_oral_scenarios` — Oral exam simulation scenarios
- `generate_drill_sets` — Practice drill sets
- `run_integrity_check` — Content completeness & consistency check
- `run_elite_hardening` — Elite quality hardening pass
- `quality_council` — AI Quality Council review
- `auto_publish` — Automated publish after all gates pass

### Support Steps
- `setup_course_package` — Initial package scaffolding
- `sync_content_versions` — Content version sync to lessons
- `rebuild_handbook` — Handbook rebuild (force)
- `backfill_blueprints` — Blueprint backfill for legacy packages
