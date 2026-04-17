UPDATE course_packages
SET 
  status = 'blocked',
  blocked_reason = 'pipeline_repair_required',
  blocked_at = COALESCE(blocked_at, now()),
  unblock_hint = 'D+ heal sweep: routed to LF-coverage / quality repair (WIP-cap aware)',
  updated_at = now()
WHERE id IN (
  '5377ab93-fe17-488c-a266-bdb26b672da7',
  '015e3cc4-b9c4-42f1-926d-346f3844030a',
  '03287d1e-a4eb-4188-b65f-82eebf66dc82'
);