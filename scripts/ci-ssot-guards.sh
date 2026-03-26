#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# SSOT UI Guard — prevents regression of canonical title / badge rules
# Run: bash scripts/ci-ssot-guards.sh
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

FAIL=0
WARNINGS=0

red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }

# ── Guard 1: No new direct renders of raw_course_title / raw_curriculum_title ─
# Allowed: CourseNamingIntegrityPanel (debug), types, dedupeVisiblePackages
echo "🔍 Guard 1: raw title rendering..."
RAW_HITS=$(grep -rn --include='*.tsx' \
  -e 'raw_course_title' -e 'raw_curriculum_title' \
  src/ \
  | grep -v 'CourseNamingIntegrityPanel' \
  | grep -v 'admin-packages.ts' \
  | grep -v 'dedupeVisiblePackages' \
  | grep -v '// raw' \
  | grep -v 'type ' \
  | grep -v 'interface ' \
  || true)

if [ -n "$RAW_HITS" ]; then
  red "❌ Guard 1 FAILED: raw_course_title / raw_curriculum_title rendered in UI"
  echo "$RAW_HITS"
  FAIL=1
else
  green "✅ Guard 1 passed: no raw title rendering in UI"
fi

# ── Guard 2: Council badge must check council_approved_at, not just council_approved ─
# Pattern: council_approved used in JSX render context (not in health score or mutation logic)
echo ""
echo "🔍 Guard 2: council_approved badge evidence..."
COUNCIL_BADGE_HITS=$(grep -rn --include='*.tsx' \
  'council_approved' \
  src/ \
  | grep -v 'council_approved_at' \
  | grep -v 'council_approved ?' \
  | grep -v 'councilApproved' \
  | grep -v 'healthScore' \
  | grep -v 'canPublish' \
  | grep -v '\.update(' \
  | grep -v '\.insert(' \
  | grep -v 'type ' \
  | grep -v 'interface ' \
  | grep -v 'useCoursePackages' \
  | grep -v 'ActiveCourseContext' \
  | grep -v 'CourseWorkspace' \
  | grep -v 'admin-packages.ts' \
  | grep -v 'hasRealCouncilOk' \
  || true)

if [ -n "$COUNCIL_BADGE_HITS" ]; then
  yellow "⚠️  Guard 2 WARNING: council_approved used outside known-good patterns"
  echo "$COUNCIL_BADGE_HITS"
  WARNINGS=$((WARNINGS + 1))
else
  green "✅ Guard 2 passed: council_approved usage is safe"
fi

# ── Guard 3: No new .from('course_packages').select('...title...') without SSOT overlay ─
echo ""
echo "🔍 Guard 3: direct course_packages title reads..."
DIRECT_TITLE_HITS=$(grep -rn --include='*.ts' --include='*.tsx' \
  "from('course_packages')" \
  src/ \
  | grep -i 'title' \
  | grep -v 'useCanonicalTitles' \
  | grep -v 'useCoursePackageDetail' \
  | grep -v 'ActiveCourseContext' \
  | grep -v 'canonical_title' \
  | grep -v 'createPackage' \
  | grep -v '\.update(' \
  | grep -v '\.insert(' \
  || true)

if [ -n "$DIRECT_TITLE_HITS" ]; then
  yellow "⚠️  Guard 3 WARNING: course_packages queried with 'title' without SSOT overlay"
  echo "$DIRECT_TITLE_HITS"
  WARNINGS=$((WARNINGS + 1))
else
  green "✅ Guard 3 passed: no unguarded direct title reads"
fi

# ── Guard 4: Gender-inclusive title check (new course titles must contain /-) ─
echo ""
echo "🔍 Guard 4: gender-inclusive title patterns..."
NON_INCLUSIVE_SEEDS=$(grep -rn --include='*.sql' --include='*.ts' \
  -e "title.*=.*'[A-Z][a-zäöü]*mann'" \
  -e "title.*=.*'[A-Z][a-zäöü]*er'" \
  src/ supabase/ \
  | grep -v '/-' \
  | grep -v 'alias' \
  | grep -v 'normalize' \
  | grep -v 'canonical' \
  | grep -v 'test' \
  | grep -v 'node_modules' \
  || true)

if [ -n "$NON_INCLUSIVE_SEEDS" ]; then
  yellow "⚠️  Guard 4 WARNING: possible non-inclusive title assignment"
  echo "$NON_INCLUSIVE_SEEDS"
  WARNINGS=$((WARNINGS + 1))
else
  green "✅ Guard 4 passed: no non-inclusive title assignments detected"
fi

# ── Guard 5: No direct build_progress WRITES in Edge Functions ─
# Reads (.select) and view references are allowed; only .update/.insert writes are forbidden
echo ""
echo "🔍 Guard 5: direct build_progress writes..."
PROGRESS_HITS=$(grep -rn --include='*.ts' \
  -e 'build_progress:' -e 'build_progress =' \
  supabase/functions/ \
  | grep -v '\.select(' \
  | grep -v 'fn_guard_build_progress' \
  | grep -v 'fn_sync_package_build_progress' \
  | grep -v 'recompute_package_progress' \
  | grep -v 'drift_audit' \
  | grep -v '// build_progress' \
  | grep -v 'pipeline-logic-test' \
  | grep -v 'node_modules' \
  | grep -v '\.build_progress' \
  | grep -v 'build_progress\?' \
  | grep -v 'build_progress ??' \
  | grep -v 'build_progress)' \
  | grep -v 'Number(.*build_progress' \
  || true)

if [ -n "$PROGRESS_HITS" ]; then
  red "❌ Guard 5 FAILED: direct build_progress write found in Edge Functions"
  echo "$PROGRESS_HITS"
  echo "build_progress is SSOT-derived from package_steps and must not be written directly."
  FAIL=1
else
  green "✅ Guard 5 passed: no direct build_progress writes in Edge Functions"
fi

# ── Guard 6: No direct progress calculations bypassing v_package_progress_ssot ─
echo ""
echo "🔍 Guard 6: direct progress calculations on package_steps..."
PROGRESS_CALC_HITS=$(grep -rn --include='*.sql' --include='*.ts' --include='*.tsx' \
  -e "count(\*) as total_steps" \
  -e "count(\*) AS total_steps" \
  -e "count(\*) as steps_total" \
  -e "count(\*) AS steps_total" \
  -e "\.length.*total.*step" \
  -e "steps\.length" \
  -e "/ total_steps \* 100" \
  -e "/ totalSteps \* 100" \
  src/ supabase/functions/ \
  | grep -iv 'v_package_progress_ssot' \
  | grep -v 'node_modules' \
  | grep -v 'ci-ssot-guards' \
  | grep -v 'ssot-guard' \
  | grep -v '\.test\.' \
  | grep -v 'pipeline-logic-test' \
  || true)

if [ -n "$PROGRESS_CALC_HITS" ]; then
  yellow "⚠️  Guard 6 WARNING: direct progress calculation found bypassing v_package_progress_ssot"
  echo "$PROGRESS_CALC_HITS"
  echo "All progress calculations must use v_package_progress_ssot. See docs/SSOT_RULES.md"
  WARNINGS=$((WARNINGS + 1))
else
  green "✅ Guard 6 passed: no direct progress calculations bypassing SSOT view"
fi

# ── Summary ─────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAIL" -gt 0 ]; then
  red "🚨 SSOT Guard FAILED ($FAIL hard failures, $WARNINGS warnings)"
  exit 1
elif [ "$WARNINGS" -gt 0 ]; then
  yellow "⚠️  SSOT Guard passed with $WARNINGS warnings (review recommended)"
  exit 0
else
  green "✅ All SSOT Guards passed"
  exit 0
fi
