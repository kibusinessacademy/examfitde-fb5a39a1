
-- Helper RPC: init steps for a package (UI sees "pending" immediately)
create or replace function public.init_course_package_steps(
  p_package_id uuid,
  p_steps text[]
) returns void
language plpgsql
security definer
as $$
declare
  s text;
begin
  foreach s in array p_steps loop
    insert into public.course_package_build_steps(package_id, step_key, status, log)
    values (p_package_id, s, 'pending', jsonb_build_object('note','queued'))
    on conflict (package_id, step_key) do nothing;
  end loop;
end $$;

revoke all on function public.init_course_package_steps(uuid, text[]) from public;
grant execute on function public.init_course_package_steps(uuid, text[]) to authenticated;
