
-- 1) Run-Log Erweiterung
alter table public.storage_audit_runs
  add column if not exists allowed_buckets text[] not null default '{}'::text[],
  add column if not exists excluded_buckets text[] not null default '{}'::text[],
  add column if not exists objects_planned integer not null default 0,
  add column if not exists cleanup_count integer not null default 0,
  add column if not exists cleanup_ok boolean,
  add column if not exists blocked_reason text,
  add column if not exists run_log jsonb not null default '[]'::jsonb;

-- 2) Top Findings nach Content-Klasse (nur leaks)
create or replace view public.v_admin_storage_attack_top_findings_by_class as
select
  coalesce(r.content_class, 'unknown') as content_class,
  count(*)::int as leak_count,
  count(distinct r.bucket_id)::int as buckets_affected,
  count(distinct r.target_path)::int as objects_affected,
  sum(case r.severity
        when 'critical' then 40
        when 'high' then 20
        when 'medium' then 8
        when 'low' then 3
        else 1 end)::int as risk_score,
  max(r.created_at) as last_seen_at,
  jsonb_agg(distinct r.bucket_id) as bucket_ids,
  jsonb_agg(distinct r.attack_type) as attack_types
from public.storage_attack_run_results r
where r.result = 'leak'
group by coalesce(r.content_class, 'unknown')
order by risk_score desc;

grant select on public.v_admin_storage_attack_top_findings_by_class to authenticated;

-- 3) Letzter Attack-Run + Block-Diagnose
create or replace view public.v_admin_storage_attack_last_run as
select
  r.id,
  r.status,
  r.source,
  r.started_at,
  r.finished_at,
  r.allowed_buckets,
  r.excluded_buckets,
  r.buckets_scanned,
  r.objects_planned,
  r.objects_sampled,
  r.cleanup_count,
  r.cleanup_ok,
  r.findings_count,
  r.blocked_reason,
  r.error_message,
  r.summary,
  r.run_log,
  (r.cleanup_ok is not true and r.status = 'completed') as block_next_full_run
from public.storage_audit_runs r
where r.run_kind = 'attack'
order by r.started_at desc
limit 1;

grant select on public.v_admin_storage_attack_last_run to authenticated;

-- 4) Block-Gate für nächsten Voll-Lauf
create or replace function public.fn_storage_attack_can_run()
returns table(can_run boolean, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  last_row record;
begin
  select * into last_row
  from public.storage_audit_runs
  where run_kind = 'attack' and status = 'completed'
  order by started_at desc
  limit 1;

  if last_row.id is null then
    return query select true, null::text; return;
  end if;

  if last_row.cleanup_ok is not true
     or coalesce(last_row.cleanup_count,0) <> coalesce(last_row.objects_sampled,0) then
    return query select false,
      format('previous attack run %s had cleanup mismatch (sampled=%s cleaned=%s cleanup_ok=%s). Manuell prüfen & freischalten.',
             last_row.id, last_row.objects_sampled, last_row.cleanup_count, last_row.cleanup_ok);
    return;
  end if;

  return query select true, null::text;
end$$;

grant execute on function public.fn_storage_attack_can_run() to authenticated;

-- 5) Admin-RPC zum manuellen Freischalten (markiert letzten Run als cleanup_ok=true)
create or replace function public.admin_storage_attack_clear_block(_run_id uuid, _note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'forbidden';
  end if;
  update public.storage_audit_runs
    set cleanup_ok = true,
        blocked_reason = null,
        run_log = run_log || jsonb_build_object(
          'event','manual_block_clear',
          'at', now(),
          'by', auth.uid(),
          'note', _note
        )
    where id = _run_id;
end$$;

grant execute on function public.admin_storage_attack_clear_block(uuid, text) to authenticated;
