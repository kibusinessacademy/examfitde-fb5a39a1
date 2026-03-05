-- Register track-lock trigger in expected_trigger_bindings
insert into public.expected_trigger_bindings (expected_trigger, expected_table, function_name, trigger_timing, trigger_events, for_each)
values ('lock_package_track', 'course_packages', 'trg_lock_package_track', 'BEFORE', '{UPDATE}', 'ROW')
on conflict (id) do nothing;