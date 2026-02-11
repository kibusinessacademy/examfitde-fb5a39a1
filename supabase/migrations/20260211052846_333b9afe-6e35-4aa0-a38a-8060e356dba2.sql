
-- ============================================================
-- SEARCH SYSTEM: Synonyms + Typo-tolerant for ExamFit
-- ============================================================

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- 1) Alias table
create table if not exists public.beruf_aliases (
  id uuid primary key default gen_random_uuid(),
  beruf_id uuid not null references public.berufe(id) on delete cascade,
  alias text not null,
  alias_norm text not null,
  priority int not null default 10,
  created_at timestamptz not null default now()
);

create index if not exists idx_beruf_aliases_beruf on public.beruf_aliases(beruf_id);
create index if not exists idx_beruf_aliases_alias_trgm on public.beruf_aliases using gin (alias_norm gin_trgm_ops);

alter table public.beruf_aliases enable row level security;

create policy "Beruf-Aliases öffentlich lesbar"
on public.beruf_aliases for select to authenticated, anon using (true);

create policy "Admins können Beruf-Aliases verwalten"
on public.beruf_aliases for all to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

-- 2) Normalize function
create or replace function public.normalize_search_text(input text)
returns text language sql immutable as $$
  select regexp_replace(lower(unaccent(coalesce(input,''))), '[^a-z0-9äöüß ]+', ' ', 'g');
$$;

-- 3) Search RPC for Berufe
create or replace function public.search_berufe(q text, lim int default 10)
returns table(
  type text, id uuid, title text, subtitle text, url text, score numeric, match_reason text
) language plpgsql stable as $$
declare
  nq text := public.normalize_search_text(q);
  search_tsquery tsquery;
begin
  if nq is null or length(trim(nq)) < 2 then return; end if;
  search_tsquery := websearch_to_tsquery('german', nq);
  return query
  with beruf_texts as (
    select b.id, b.bezeichnung_kurz,
      coalesce(b.bezeichnung_lang, '') as bezeichnung_lang,
      public.normalize_search_text(
        b.bezeichnung_kurz || ' ' || coalesce(b.bezeichnung_lang,'') || ' ' || coalesce(agg.aliases, '')
      ) as search_text,
      to_tsvector('german', public.normalize_search_text(
        b.bezeichnung_kurz || ' ' || coalesce(b.bezeichnung_lang,'') || ' ' || coalesce(agg.aliases, '')
      )) as search_tsv
    from public.berufe b
    left join lateral (
      select string_agg(ba.alias, ' ') as aliases from public.beruf_aliases ba where ba.beruf_id = b.id
    ) agg on true
    where b.ist_aktiv = true
  ),
  candidates as (
    select 'beruf'::text as type, bt.id, bt.bezeichnung_kurz as title,
      bt.bezeichnung_lang as subtitle, '/berufe/' || bt.id::text as url,
      (ts_rank_cd(bt.search_tsv, search_tsquery) * 10 + greatest(similarity(bt.search_text, nq), 0))::numeric as score,
      case when bt.search_tsv @@ search_tsquery then 'fts'
           when similarity(bt.search_text, nq) > 0.25 then 'fuzzy'
           else 'weak' end as match_reason
    from beruf_texts bt
    where bt.search_tsv @@ search_tsquery or bt.search_text % nq or similarity(bt.search_text, nq) > 0.25
  )
  select * from candidates order by score desc limit lim;
end;
$$;

-- 4) Unified search RPC
create or replace function public.search_public(q text, lim int default 10, types text[] default array['beruf'])
returns table(
  type text, id uuid, title text, subtitle text, url text, score numeric, match_reason text
) language plpgsql stable as $$
begin
  if types is null or array_length(types,1) is null then types := array['beruf']; end if;
  return query
  with all_results as (
    select sb.* from public.search_berufe(q, lim) sb where 'beruf' = any(types)
    union all
    select sd.doc_type::text, sd.id, sd.title,
      coalesce(sd.meta_description, sd.excerpt, ''),
      '/' || case sd.doc_type when 'blog' then 'wissen/' when 'faq' then 'faq#' when 'glossary' then 'glossar/' when 'landing' then 'pruefungstraining/' else 'wissen/' end || sd.slug,
      (ts_rank_cd(to_tsvector('german', public.normalize_search_text(sd.title || ' ' || coalesce(sd.excerpt,''))),
        websearch_to_tsquery('german', public.normalize_search_text(q))) * 8
       + greatest(similarity(public.normalize_search_text(sd.title), public.normalize_search_text(q)), 0))::numeric,
      'fts'::text
    from public.seo_documents sd
    where 'seo' = any(types) and sd.status = 'published'
      and (to_tsvector('german', public.normalize_search_text(sd.title || ' ' || coalesce(sd.excerpt,'')))
            @@ websearch_to_tsquery('german', public.normalize_search_text(q))
           or similarity(public.normalize_search_text(sd.title), public.normalize_search_text(q)) > 0.25)
    union all
    select 'course'::text, c.id, c.title, coalesce(c.description, ''),
      '/courses/' || c.id::text,
      (ts_rank_cd(to_tsvector('german', public.normalize_search_text(c.title || ' ' || coalesce(c.description,''))),
        websearch_to_tsquery('german', public.normalize_search_text(q))) * 8
       + greatest(similarity(public.normalize_search_text(c.title), public.normalize_search_text(q)), 0))::numeric,
      'fts'::text
    from public.courses c
    where 'course' = any(types)
      and (to_tsvector('german', public.normalize_search_text(c.title || ' ' || coalesce(c.description,'')))
            @@ websearch_to_tsquery('german', public.normalize_search_text(q))
           or similarity(public.normalize_search_text(c.title), public.normalize_search_text(q)) > 0.25)
  )
  select * from all_results order by score desc limit lim;
end;
$$;

-- 5) Seed aliases
insert into public.beruf_aliases (beruf_id, alias, alias_norm, priority) values
  ('52f78e37-4763-46cf-a31d-7aa173194b7a', 'Banker', public.normalize_search_text('Banker'), 3),
  ('52f78e37-4763-46cf-a31d-7aa173194b7a', 'Bankkauffrau', public.normalize_search_text('Bankkauffrau'), 1),
  ('52f78e37-4763-46cf-a31d-7aa173194b7a', 'Kundenberater Bank', public.normalize_search_text('Kundenberater Bank'), 5),
  ('52f78e37-4763-46cf-a31d-7aa173194b7a', 'Bankberater', public.normalize_search_text('Bankberater'), 4),
  ('6c861f09-7b74-4aca-9358-b3af896b2c51', 'Bestatter', public.normalize_search_text('Bestatter'), 1),
  ('6c861f09-7b74-4aca-9358-b3af896b2c51', 'Bestattungsunternehmer', public.normalize_search_text('Bestattungsunternehmer'), 3),
  ('6c861f09-7b74-4aca-9358-b3af896b2c51', 'Thanatopraktiker', public.normalize_search_text('Thanatopraktiker'), 7),
  ('b814ad77-acff-410b-b3f0-2f6748bc82f0', 'Heizungsbauer', public.normalize_search_text('Heizungsbauer'), 1),
  ('b814ad77-acff-410b-b3f0-2f6748bc82f0', 'Sanitärinstallateur', public.normalize_search_text('Sanitärinstallateur'), 1),
  ('b814ad77-acff-410b-b3f0-2f6748bc82f0', 'Klempner', public.normalize_search_text('Klempner'), 2),
  ('b814ad77-acff-410b-b3f0-2f6748bc82f0', 'Heizungsinstallateur', public.normalize_search_text('Heizungsinstallateur'), 2),
  ('b814ad77-acff-410b-b3f0-2f6748bc82f0', 'SHK', public.normalize_search_text('SHK'), 3),
  ('ea339f82-57e5-4f58-9ed9-bdeb4e716ef3', 'Automobilkauffrau', public.normalize_search_text('Automobilkauffrau'), 1),
  ('ea339f82-57e5-4f58-9ed9-bdeb4e716ef3', 'Autokaufmann', public.normalize_search_text('Autokaufmann'), 3),
  ('ea339f82-57e5-4f58-9ed9-bdeb4e716ef3', 'Kfz-Kaufmann', public.normalize_search_text('Kfz-Kaufmann'), 4),
  ('e155a91a-d375-47ad-9cc1-545fd111ca3d', 'Bäckerin', public.normalize_search_text('Bäckerin'), 1),
  ('e155a91a-d375-47ad-9cc1-545fd111ca3d', 'Bäckermeister', public.normalize_search_text('Bäckermeister'), 3),
  ('04d03eb2-85bb-4cea-b626-637982a51da9', 'Dachdeckerhandwerk', public.normalize_search_text('Dachdeckerhandwerk'), 2),
  ('04d03eb2-85bb-4cea-b626-637982a51da9', 'Dachbau', public.normalize_search_text('Dachbau'), 4),
  ('1e9a960c-25e5-4ca6-9181-96b4c9f24b9b', 'LKW-Fahrer', public.normalize_search_text('LKW-Fahrer'), 1),
  ('1e9a960c-25e5-4ca6-9181-96b4c9f24b9b', 'Trucker', public.normalize_search_text('Trucker'), 5),
  ('1e9a960c-25e5-4ca6-9181-96b4c9f24b9b', 'Kraftfahrer', public.normalize_search_text('Kraftfahrer'), 2),
  ('1e9a960c-25e5-4ca6-9181-96b4c9f24b9b', 'Busfahrer', public.normalize_search_text('Busfahrer'), 3),
  ('5782ff4a-3f13-4db3-b821-dd97ed88527d', 'Chemielaborantin', public.normalize_search_text('Chemielaborantin'), 1),
  ('5782ff4a-3f13-4db3-b821-dd97ed88527d', 'Laborant Chemie', public.normalize_search_text('Laborant Chemie'), 3),
  ('802ba64d-fcc1-4ad1-848a-cfa03a6bc08e', 'Buchhändlerin', public.normalize_search_text('Buchhändlerin'), 1),
  ('802ba64d-fcc1-4ad1-848a-cfa03a6bc08e', 'Buchhandel', public.normalize_search_text('Buchhandel'), 2);
