# ExamFit v2 Intelligence Loop — Forensic QA Plan

> Last updated: 2026-03-15
> Status: Ready for execution

## Purpose

Validate the complete v2 learning intelligence loop:
**Action → Telemetry → Snapshot → Recommendations → Tutor Context**

## Prerequisites

- Two test users (User A, User B) enrolled in the same curriculum
- At least one course with MiniCheck-enabled lessons
- At least one exam blueprint for simulation
- Access to database to verify records

---

## Test Cases

### TC-01: MiniCheck → Single Snapshot
**Flow:** Complete a MiniCheck in a lesson.

**Verify:**
1. `learning_events` contains exactly ONE `minicheck_completed` row
2. `learning_events` contains exactly ONE `lesson_completed` row (from completeLesson)
3. `exam_readiness_snapshots` contains exactly ONE new snapshot (not two)
4. `user_recommendations` old recs are `is_active = false`
5. `user_recommendations` has 1–4 new active recs

**SQL:**
```sql
SELECT event_type, count(*)
FROM learning_events
WHERE user_id = '<USER_ID>'
  AND created_at > now() - interval '2 minutes'
GROUP BY event_type;

SELECT count(*) FROM exam_readiness_snapshots
WHERE user_id = '<USER_ID>'
  AND calculated_at > now() - interval '2 minutes';
```

### TC-02: Rapid MiniCheck Double-Click
**Flow:** Complete a MiniCheck and immediately trigger again (fast retry).

**Verify:**
1. Client debounce (5s) blocks second `snapshotExamReadiness` call
2. If somehow both reach server, server debounce (30s structural compare) blocks second snapshot
3. Maximum ONE snapshot created

### TC-03: Exam Simulation → Snapshot + Weakness Assignments
**Flow:** Complete an exam simulation.

**Verify:**
1. `learning_events` contains ONE `exam_sim_completed` row
2. `exam_readiness_snapshots` has one new snapshot
3. `user_recommendations` updated — should include `exam_sim` type if readiness ≥ 65%
4. `create_weakness_assignments_from_exam` RPC was called (check weakness_assignments table)

### TC-04: H5P Lesson → Snapshot
**Flow:** Complete a lesson via H5P content (no MiniCheck).

**Verify:**
1. `learning_events` contains ONE `lesson_completed` row
2. `exam_readiness_snapshots` has one new snapshot (triggered by handleH5PCompleted)

### TC-05: Snapshot Structural Debounce
**Flow:** Trigger snapshot twice within 30s with identical readiness state.

**Verify:**
1. First call: `ok: true, debounced: false` (or no debounced field)
2. Second call: `ok: true, debounced: true`
3. Only ONE snapshot row in database

**SQL:**
```sql
SELECT id, readiness_score, risk_level, mastered_count, calculated_at
FROM exam_readiness_snapshots
WHERE user_id = '<USER_ID>'
ORDER BY calculated_at DESC
LIMIT 5;
```

### TC-06: Snapshot After Real Change
**Flow:** Complete MiniCheck (snapshot #1), then complete another MiniCheck with different score (snapshot #2).

**Verify:**
1. Two snapshots exist with different readiness_score or mastered_count
2. Debounce did NOT suppress the second (because structural fields changed)

### TC-07: Recommendation Completeness
**Flow:** User with low readiness (< 40%) triggers snapshot.

**Verify:**
1. Recommendations include `lesson` type with `LOW_MASTERY_HIGH_WEIGHT` reason_code
2. NO `exam_sim` recommendation (readiness too low)
3. All recs have `generation_id` in meta (atomicity marker)

### TC-08: Recommendation Fallback
**Flow:** User with high readiness (≥ 80%) and no weak competencies triggers snapshot.

**Verify:**
1. `exam_sim` recommendation exists
2. If no weakness recs generated, at least `review` fallback exists
3. System never returns zero active recommendations

### TC-09: Tutor Context User Isolation
**Flow:** User A (readiness 45%, gaps in LF06) and User B (readiness 78%, gaps in LF03) ask the same tutor question.

**Verify:**
1. Tutor response for User A references LF06 weaknesses
2. Tutor response for User B references LF03 weaknesses
3. Readiness scores in system prompt differ
4. Suggested coaching mode differs (A=coach, B=examiner)

**How to verify:**
- Check edge function logs for `[ai-tutor]` entries
- Or temporarily log the systemPrompt length/hash

### TC-10: Tutor Context Without Readiness Data
**Flow:** New user (no snapshots yet) asks tutor a question.

**Verify:**
1. Tutor still works (no crash)
2. No readiness/gap sections in prompt
3. Response is generic but helpful

### TC-11: Recommendation Parallel Safety
**Flow:** Two browser tabs complete MiniCheck simultaneously for same user+curriculum.

**Verify:**
1. After both complete, exactly ONE set of active recommendations exists
2. No orphaned active recs from the slower request
3. `generation_id` in meta is consistent across all active recs

**SQL:**
```sql
SELECT id, recommendation_type, reason_code, is_active, meta->>'generation_id' as gen_id
FROM user_recommendations
WHERE user_id = '<USER_ID>'
  AND curriculum_id = '<CURRICULUM_ID>'
ORDER BY generated_at DESC
LIMIT 20;
```

### TC-12: Event Telemetry Completeness
**Flow:** Full learning session: start lesson → complete MiniCheck → start exam → finish exam.

**Verify:**
```sql
SELECT event_type, count(*), min(created_at), max(created_at)
FROM learning_events
WHERE user_id = '<USER_ID>'
  AND created_at > now() - interval '1 hour'
GROUP BY event_type
ORDER BY min(created_at);
```

Expected events in order:
1. `lesson_completed` (1x)
2. `minicheck_completed` (1x)
3. `exam_sim_completed` (1x)

---

## Pass Criteria

| Category | Criterion |
|---|---|
| No duplicates | TC-01, TC-02, TC-05: max 1 snapshot per trigger |
| Structural debounce | TC-05 debounced, TC-06 not debounced |
| Recommendations | TC-07, TC-08: always ≥ 1 active rec |
| Atomicity | TC-11: single generation_id for active set |
| User isolation | TC-09: different context per user |
| Graceful degradation | TC-10: no crash without data |
| Completeness | TC-12: all event types present |

## Invariants Referenced

- **INV-056**: Every significant learning action must emit a telemetry event
- **INV-057**: Readiness snapshots are server-side only
- **INV-058**: Gap types: acute, unstable, blind
- **INV-059**: Recommendations never empty
- **INV-060**: Tutor context loaded server-side per user_id + curriculum_id
