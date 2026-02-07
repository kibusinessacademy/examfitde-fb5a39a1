-- 9C: Course Evidence Packs - Immutable Audit Archive
-- =====================================================

-- Enable pgcrypto for SHA256 hashing
create extension if not exists pgcrypto;

-- Table: course_evidence_packs
create table if not exists public.course_evidence_packs (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  curriculum_id uuid not null references public.curricula(id) on delete restrict,

  -- Snapshot Meta
  generated_at timestamptz not null default now(),
  generated_by uuid null,

  -- Integrity
  fingerprint_sha256 text not null,
  export_version text not null default '1.0',

  -- Storage (optional - for large packs)
  storage_bucket text null,
  storage_path text null,

  -- Inline payload (optional; for smaller packs)
  pack jsonb null,

  -- Soft immutability
  is_immutable boolean not null default true,

  -- Convenience
  notes text null,
  
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_course_evidence_packs_course_id on public.course_evidence_packs(course_id);
create index if not exists idx_course_evidence_packs_curriculum_id on public.course_evidence_packs(curriculum_id);
create unique index if not exists uq_course_pack_fingerprint on public.course_evidence_packs(fingerprint_sha256);

-- RLS
alter table public.course_evidence_packs enable row level security;

-- Admin read policy
create policy "Admins can view evidence packs"
on public.course_evidence_packs
for select
using (has_role(auth.uid(), 'admin'::app_role));

-- Admin insert policy
create policy "Admins can create evidence packs"
on public.course_evidence_packs
for insert
with check (has_role(auth.uid(), 'admin'::app_role));

-- No update/delete policies - packs are immutable

-- Function: create_course_evidence_pack
-- Generates pack via export_course_pack, fingerprints, and stores
create or replace function public.create_course_evidence_pack(
  p_course_id uuid,
  p_include_questions boolean default false,
  p_include_h5p boolean default true,
  p_store_inline boolean default true,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack jsonb;
  v_curriculum_id uuid;
  v_fingerprint text;
  v_row public.course_evidence_packs;
  v_existing_id uuid;
begin
  -- Auth guard
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Forbidden (admin only)';
  end if;

  -- Get curriculum_id from course
  select curriculum_id into v_curriculum_id
  from public.courses
  where id = p_course_id;

  if v_curriculum_id is null then
    raise exception 'Course % has no curriculum_id (SSOT violation)', p_course_id;
  end if;

  -- Generate pack using 9B function
  v_pack := public.export_course_pack(p_course_id, p_include_questions, p_include_h5p);

  -- Calculate SHA256 fingerprint
  v_fingerprint := encode(digest(v_pack::text, 'sha256'), 'hex');

  -- Check if this exact pack already exists
  select id into v_existing_id
  from public.course_evidence_packs
  where fingerprint_sha256 = v_fingerprint;

  if v_existing_id is not null then
    -- Return existing pack info (idempotent)
    select * into v_row
    from public.course_evidence_packs
    where id = v_existing_id;
    
    return jsonb_build_object(
      'status', 'existing',
      'message', 'Evidence pack with identical fingerprint already exists',
      'pack_id', v_row.id,
      'fingerprint', v_row.fingerprint_sha256,
      'generated_at', v_row.generated_at,
      'course_id', v_row.course_id,
      'curriculum_id', v_row.curriculum_id
    );
  end if;

  -- Insert new pack
  insert into public.course_evidence_packs (
    course_id, 
    curriculum_id, 
    generated_by,
    fingerprint_sha256, 
    export_version,
    pack,
    notes
  )
  values (
    p_course_id, 
    v_curriculum_id, 
    auth.uid(),
    v_fingerprint, 
    coalesce(v_pack->>'export_version', '1.0'),
    case when p_store_inline then v_pack else null end,
    p_notes
  )
  returning * into v_row;

  return jsonb_build_object(
    'status', 'created',
    'message', 'Evidence pack created and archived',
    'pack_id', v_row.id,
    'fingerprint', v_row.fingerprint_sha256,
    'generated_at', v_row.generated_at,
    'course_id', v_row.course_id,
    'curriculum_id', v_row.curriculum_id,
    'has_inline_pack', (v_row.pack is not null)
  );
end;
$$;

-- Function: get_evidence_pack
-- Retrieves a stored evidence pack by ID
create or replace function public.get_evidence_pack(p_pack_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.course_evidence_packs;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Forbidden (admin only)';
  end if;

  select * into v_row
  from public.course_evidence_packs
  where id = p_pack_id;

  if v_row.id is null then
    raise exception 'Evidence pack % not found', p_pack_id;
  end if;

  return jsonb_build_object(
    'pack_id', v_row.id,
    'course_id', v_row.course_id,
    'curriculum_id', v_row.curriculum_id,
    'generated_at', v_row.generated_at,
    'generated_by', v_row.generated_by,
    'fingerprint', v_row.fingerprint_sha256,
    'export_version', v_row.export_version,
    'is_immutable', v_row.is_immutable,
    'has_inline_pack', (v_row.pack is not null),
    'storage_bucket', v_row.storage_bucket,
    'storage_path', v_row.storage_path,
    'notes', v_row.notes,
    'pack', v_row.pack
  );
end;
$$;

-- Function: verify_evidence_pack_integrity
-- Recalculates fingerprint and compares to stored value
create or replace function public.verify_evidence_pack_integrity(p_pack_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.course_evidence_packs;
  v_current_fingerprint text;
  v_matches boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Forbidden (admin only)';
  end if;

  select * into v_row
  from public.course_evidence_packs
  where id = p_pack_id;

  if v_row.id is null then
    raise exception 'Evidence pack % not found', p_pack_id;
  end if;

  if v_row.pack is null then
    return jsonb_build_object(
      'pack_id', p_pack_id,
      'status', 'skipped',
      'message', 'Pack stored externally, cannot verify inline',
      'stored_fingerprint', v_row.fingerprint_sha256
    );
  end if;

  -- Recalculate fingerprint
  v_current_fingerprint := encode(digest(v_row.pack::text, 'sha256'), 'hex');
  v_matches := (v_current_fingerprint = v_row.fingerprint_sha256);

  return jsonb_build_object(
    'pack_id', p_pack_id,
    'status', case when v_matches then 'verified' else 'tampered' end,
    'integrity_ok', v_matches,
    'stored_fingerprint', v_row.fingerprint_sha256,
    'calculated_fingerprint', v_current_fingerprint,
    'generated_at', v_row.generated_at
  );
end;
$$;