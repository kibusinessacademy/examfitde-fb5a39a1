# Job Payload Contract Report
# Generated: 2026-04-07T20:13:38.124Z
# Source: src/lib/contracts/job-payload-schemas.ts
# Total registered job types: 45

| Job Type | Pool | Payload Keys (? = optional) |
|----------|------|-----------------------------|
| `pipeline_tick` | — | trigger? |
| `stuck_scan` | — | threshold_minutes? |
| `setup_course_package` | — | course_id?, curriculum_id?, package_id, program_type?, track? |
| `generate_curriculum_content` | — | course_id?, curriculum_id?, learning_field_filter?, package_id |
| `package_scaffold_learning_course` | — | course_id?, curriculum_id?, package_id |
| `package_fanout_learning_content` | — | course_id?, curriculum_id?, package_id |
| `package_generate_learning_content` | — | course_id?, curriculum_id?, learning_field_filter?, package_id |
| `lesson_generate_content` | — | competency_id?, course_id?, curriculum_id?, lesson_id?, package_id |
| `lesson_generate_content_shard` | — | course_id?, curriculum_id?, lesson_id, package_id, shard_index? |
| `lesson_generate_competency_bundle` | — | competency_id, course_id?, curriculum_id?, package_id |
| `package_finalize_learning_content` | — | course_id?, curriculum_id?, package_id |
| `package_validate_learning_content` | — | course_id?, curriculum_id?, package_id |
| `package_generate_lesson_minichecks` | — | course_id?, curriculum_id?, package_id |
| `package_validate_lesson_minichecks` | — | course_id?, curriculum_id?, package_id |
| `package_generate_handbook` | — | course_id?, curriculum_id?, package_id |
| `package_validate_handbook` | — | course_id?, curriculum_id?, package_id |
| `package_validate_handbook_depth` | — | course_id?, curriculum_id?, package_id |
| `package_enqueue_handbook_expand` | — | course_id?, curriculum_id?, package_id |
| `handbook_expand_section` | — | course_id?, curriculum_id?, package_id, section_id?, section_title? |
| `package_generate_glossary` | — | course_id?, curriculum_id?, package_id |
| `package_auto_seed_exam_blueprints` | — | course_id?, curriculum_id?, package_id |
| `package_validate_blueprints` | — | course_id?, curriculum_id?, package_id |
| `package_generate_blueprint_variants` | — | blueprint_id?, course_id?, curriculum_id?, package_id, target_count? |
| `blueprint_generate_variants` | — | blueprint_id?, course_id?, curriculum_id?, package_id, target_count? |
| `package_validate_blueprint_variants` | — | course_id?, curriculum_id?, package_id |
| `package_promote_blueprint_variants` | — | course_id?, curriculum_id?, package_id |
| `ensure_variant_inventory` | — | course_id?, curriculum_id?, package_id |
| `validate_variant_inventory` | — | course_id?, curriculum_id?, package_id |
| `package_generate_exam_pool` | — | course_id?, curriculum_id?, package_id |
| `package_validate_exam_pool` | — | course_id?, curriculum_id?, package_id |
| `package_repair_exam_pool_quality` | — | course_id?, curriculum_id?, package_id, reason_codes? |
| `package_repair_minichecks` | — | course_id?, curriculum_id?, package_id |
| `package_exam_rebalance` | — | course_id?, curriculum_id?, package_id, rebalance_mode? |
| `pool_fill_bloom_gaps` | — | course_id?, curriculum_id?, package_id |
| `pool_fill_lf_gaps` | — | course_id?, curriculum_id?, package_id |
| `pool_fill_trap_gaps` | — | course_id?, curriculum_id?, package_id |
| `rework_trap_retrofit` | — | course_id?, curriculum_id?, package_id |
| `package_generate_oral_exam` | — | course_id?, curriculum_id?, package_id |
| `package_validate_oral_exam` | — | course_id?, curriculum_id?, package_id |
| `package_build_ai_tutor_index` | — | course_id?, curriculum_id?, package_id |
| `package_validate_tutor_index` | — | course_id?, curriculum_id?, package_id |
| `package_run_integrity_check` | — | course_id?, curriculum_id?, package_id |
| `package_quality_council` | — | course_id?, curriculum_id?, package_id |
| `package_elite_harden` | — | course_id?, curriculum_id?, package_id |
| `package_auto_publish` | — | course_id?, curriculum_id?, package_id |
