
INSERT INTO public.expected_trigger_bindings (expected_trigger, expected_schema, expected_table, function_name, function_schema, trigger_timing, trigger_events, for_each)
VALUES (
  'trg_post_publish_learner_e2e',
  'public',
  'course_packages',
  'trg_fn_post_publish_learner_e2e',
  'public',
  'AFTER',
  '{UPDATE}',
  'ROW'
);
