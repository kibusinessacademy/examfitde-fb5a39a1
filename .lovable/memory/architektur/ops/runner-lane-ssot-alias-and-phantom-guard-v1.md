---
name: Runner-Lane-SSOT Alias & Phantom-Guard
description: DB-Lane 'build' = Code-Lane 'generation' (Alias), 'marketing' separat. claim_pending_jobs_by_types canceled Phantom-Jobs (Step bereits done) statt zu claimen.
type: feature
---
- `derive_job_lane()` (DB) stempelt Jobs mit Lane='build' (alle generate_*) und 'marketing' (seo_*).
- `runner-lanes.ts` (Code) muss die DB-Lane-Namen kennen: `RunnerLane = control|recovery|generation|build|marketing`.
- `jobTypesForLane('build')` mapped auf das gleiche Job-Type-Set wie 'generation' (Alias).
- content-runner claimt `["generation","build"]`, job-runner `["control","recovery","marketing"]`.
- `claim_pending_jobs_by_types` enthält jetzt einen Phantom-Sweep: pending Jobs für `package_*` deren Step in `package_steps` bereits `done|skipped` ist, werden vor dem Claim cancelled mit `last_error_code='STEP_ALREADY_DONE_PHANTOM'`.
- `admin_heal_failed_quality_councils()` setzt failed quality_council Steps auf queued zurück (mit `allow_regression=true`), damit auto_publish nicht ewig blockiert.
