-- Remove p_password parameter from create_enterprise_account function
-- The password is never used in SQL; auth user creation happens in the edge function
DROP FUNCTION IF EXISTS public.create_enterprise_account(uuid, uuid, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_enterprise_account(
  p_package_id uuid,
  p_seat_id uuid,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_personnel_number text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_caller_id uuid := auth.uid();
  v_pkg public.license_packages%rowtype;
  v_seat public.license_seats%rowtype;
  v_internal_email text;
  v_new_user_id uuid;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_pkg from public.license_packages where id = p_package_id;
  if v_pkg.id is null then raise exception 'Package not found'; end if;
  if v_pkg.buyer_user_id <> v_caller_id then raise exception 'Not authorized'; end if;
  if v_pkg.status <> 'active' then raise exception 'Package not active'; end if;

  select * into v_seat from public.license_seats where id = p_seat_id and package_id = p_package_id;
  if v_seat.id is null then raise exception 'Seat not found in package'; end if;
  if v_seat.assigned_user_id is not null then raise exception 'Seat already assigned'; end if;

  if exists (select 1 from public.profiles where login_username = lower(trim(p_username))) then
    raise exception 'Username already taken';
  end if;

  v_internal_email := coalesce(p_email, lower(trim(p_username)) || '@managed.examfit.internal');
  v_new_user_id := gen_random_uuid();

  update public.license_seats
  set licensee_first_name = p_first_name,
      licensee_last_name = p_last_name,
      licensee_personnel_number = p_personnel_number
  where id = p_seat_id;

  return v_new_user_id;
end;
$$;