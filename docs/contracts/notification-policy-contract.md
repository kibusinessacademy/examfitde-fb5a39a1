# Notification Policy Contract (Track 2.F)

**Status**: SSOT  
**Owner**: Notification Platform  
**Last update**: Track 2.F — Finalization

## 1. Purpose

This contract defines the immutable invariants of the adaptive notification
system (Tracks 2.1 – 2.5). Any code path that sends a learner notification
MUST satisfy every invariant below. Violations are CI-blocking.

## 2. Pipeline (SSOT)

```
enqueue (notification_jobs)
        ↓
fn_enforce_notification_policy(p_job_id)   ← MUST be called before send
        ↓
notification_dispatch_decisions (append-only audit)
        ↓
edge:send-learner-push (only on action=allowed)
        ↓
notification_events (delivered / opened / cta_clicked / goal_resolved)
```

## 3. Invariants

| ID  | Invariant                                                                 | Enforced by |
|-----|---------------------------------------------------------------------------|-------------|
| I1  | No notification leaves the system without a `notification_dispatch_decisions` row | DB function + edge fn |
| I2  | `safety_class='critical'` intents are NEVER `suppressed`/`downranked`/`cooldown` | Resolver + Engine clamp |
| I3  | Strategy flips require ≥2 consecutive proposals (Hysteresis) + 24h cooldown | Engine guard |
| I4  | Adaptive engine ignores samples with `sent < 30` (Confidence Guard)        | Engine guard |
| I5  | Global Kill-Switch (`notification_kill_switch.paused=true`) suppresses all non-critical jobs | Enforcement fn |
| I6  | Every kill-switch toggle requires a non-empty reason and is mirrored to `auto_heal_log` | RPC |
| I7  | Resolver may be stricter than the stored policy but NEVER more permissive  | Defense-in-depth |
| I8  | Drilldown `admin_explain_notification_decision(job_id)` MUST return registry + policy + decisions + events + kill-switch state | RPC |
| I9  | Tests `admin_smoke_notification_e2e()` and `admin_smoke_policy_enforcement()` MUST stay green | CI smoke |

## 4. Critical Intent Allow-List

Always-on, never auto-suppressed:

- `exam_countdown`
- `payment_reminder`
- `support_reply`

Changes require a documented governance decision and the corresponding
`safety_class` update in `notification_intent_registry`.

## 5. Forbidden Patterns (CI-Guard)

Searched in `src/`, `supabase/functions/`:

- `from('notification_jobs').update(...state: 'delivered')` without prior `fn_enforce_notification_policy` call in the same file
- Direct `INSERT INTO notification_dispatch_decisions` from any code path other than `fn_enforce_notification_policy` (only the DB function is the canonical writer)
- Suppression of `exam_countdown` / `payment_reminder` / `support_reply` via any client / edge code path
- New notification kinds added to `notification_jobs_kind_check` without a registry row in `notification_intent_registry`

## 6. Operational Runbooks

- **Pause everything**: Heal Cockpit → Notification Finalization card → "Pause All" (reason required).
- **Resume**: same card → "Resume" (reason required).
- **Why didn't user X get notification Y?**: copy `notification_jobs.id`, paste into the Drilldown input → returns full audit bundle.
- **Pre-deploy smoke**: run `select * from admin_smoke_notification_e2e()` — all 6 stages must pass.

## 7. Compliance (EU-AI-Act / DSGVO)

- Every dispatch decision is explainable (Drilldown → human-readable reasons).
- Engine decisions are deterministic, not ML black-box (Track 2.4 design choice).
- Learners see the same reasons via `learner_get_recent_notifications`.
- Kill-Switch provides an immediate, audited halt for any compliance incident.
