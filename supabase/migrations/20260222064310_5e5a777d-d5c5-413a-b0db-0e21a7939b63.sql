
-- =========================================================
-- Humor Preferences (Opt-out) – pro User
-- =========================================================

create table if not exists public.user_humor_preferences (
  user_id uuid primary key,
  humor_enabled boolean not null default true,
  humor_push_enabled boolean not null default false,
  tone_preference text not null default 'auto',
  modernity_range text not null default '45-80',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_humor_tone_check check (tone_preference in ('auto','business','casual')),
  constraint user_humor_modernity_check check (modernity_range ~ '^\d{1,3}-\d{1,3}$')
);

drop trigger if exists trg_user_humor_prefs_updated_at on public.user_humor_preferences;
create trigger trg_user_humor_prefs_updated_at
before update on public.user_humor_preferences
for each row execute function public.set_updated_at();

alter table public.user_humor_preferences enable row level security;

drop policy if exists "user_humor_prefs_select_own" on public.user_humor_preferences;
create policy "user_humor_prefs_select_own"
on public.user_humor_preferences
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "user_humor_prefs_insert_own" on public.user_humor_preferences;
create policy "user_humor_prefs_insert_own"
on public.user_humor_preferences
for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "user_humor_prefs_update_own" on public.user_humor_preferences;
create policy "user_humor_prefs_update_own"
on public.user_humor_preferences
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
