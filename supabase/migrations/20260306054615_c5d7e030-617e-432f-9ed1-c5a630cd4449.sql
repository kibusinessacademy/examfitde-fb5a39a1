CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_package_per_curriculum
ON course_packages (curriculum_id)
WHERE status IN ('building','published');