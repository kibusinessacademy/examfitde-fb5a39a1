
CREATE OR REPLACE VIEW ops_blocked_packages AS
SELECT cp.id AS package_id,
    cp.title,
    cp.status,
    cp.build_progress,
    cp.integrity_passed,
    cp.integrity_report,
    cp.council_approved,
    cp.created_at,
    ar.status AS autofix_status,
    ar.current_round AS autofix_round,
    ar.last_score AS autofix_last_score,
    ss.seed_status,
    ss.seed_reasons,
    ss.seeding_version,
    ss.version_status,
    ss.avg_competencies_per_lf,
    ss.empty_lf_count,
    ss.orphan_competency_count,
    CASE
        WHEN cp.status = 'blocked' AND cp.blocked_reason IS NOT NULL THEN cp.blocked_reason
        WHEN cp.status = 'blocked' THEN 'admin_blocked'
        WHEN ss.seed_status = ANY (ARRAY['missing', 'partial']) AND cp.build_progress < 20 THEN 'seed_incomplete'
        WHEN cp.status = 'failed' AND ar.status = 'frozen' THEN 'regression_freeze'
        WHEN cp.status = 'failed' AND ar.status = 'budget_exceeded' THEN 'budget_exceeded'
        WHEN cp.status = 'failed' THEN 'build_failed'
        WHEN cp.integrity_passed = false AND cp.status NOT IN ('building') THEN 'integrity_failed'
        ELSE 'unknown'
    END AS block_reason,
    CASE
        WHEN cp.status = 'blocked' THEN 0
        WHEN ss.seed_status = ANY (ARRAY['missing', 'partial']) AND cp.build_progress < 20 THEN 1
        WHEN cp.status = 'failed' THEN 2
        WHEN cp.integrity_passed = false THEN 3
        ELSE 4
    END AS block_priority
FROM course_packages cp
  LEFT JOIN ops_seeding_summary ss ON ss.package_id = cp.id
  LEFT JOIN LATERAL (
    SELECT afr.status, afr.current_round, afr.last_score
    FROM autofix_runs afr
    WHERE afr.package_id = cp.id
    ORDER BY afr.created_at DESC
    LIMIT 1
  ) ar ON true
WHERE
  -- Actually blocked packages
  cp.status = 'blocked'
  -- Failed packages
  OR cp.status = 'failed'
  -- Seed incomplete but only for early-stage packages (not actively building with progress)
  OR (cp.status IN ('building', 'council_review', 'qa', 'planning') 
      AND ss.seed_status IN ('missing', 'partial') 
      AND cp.build_progress < 20)
  -- Integrity failed but NOT for actively building packages (they self-heal)
  OR (cp.integrity_passed = false 
      AND cp.status NOT IN ('building'))
ORDER BY
  CASE
    WHEN cp.status = 'blocked' THEN 0
    WHEN ss.seed_status = ANY (ARRAY['missing', 'partial']) AND cp.build_progress < 20 THEN 1
    WHEN cp.status = 'failed' THEN 2
    WHEN cp.integrity_passed = false THEN 3
    ELSE 4
  END,
  cp.created_at;
