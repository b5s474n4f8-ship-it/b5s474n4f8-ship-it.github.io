create extension if not exists pgcrypto;

create table if not exists public.guiliu_feed_candidates (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  platform text not null default 'unknown',
  source_type text not null default 'manual',
  sources text[] not null default '{}',
  video_key text not null,
  title text not null,
  channel_name text not null default '',
  channel_key text not null default '',
  thumbnail_url text not null default '',
  duration_text text not null default '',
  published_text text not null default '',
  view_count_text text not null default '',
  url text not null,
  embed_url text not null default '',
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, video_key)
);

create table if not exists public.guiliu_feedback (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_key text not null,
  candidate_id text not null default '',
  feedback_type text not null,
  reasons text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, video_key)
);

create table if not exists public.guiliu_ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'Chrome/Edge 插件',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.guiliu_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  platform text not null,
  source_type text not null default 'channel',
  source_key text not null,
  name text not null,
  url text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, platform, source_key)
);

alter table public.guiliu_feed_candidates enable row level security;
alter table public.guiliu_feedback enable row level security;
alter table public.guiliu_ingest_tokens enable row level security;
alter table public.guiliu_sources enable row level security;

drop policy if exists "read own feed" on public.guiliu_feed_candidates;
create policy "read own feed" on public.guiliu_feed_candidates for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "manage own feedback" on public.guiliu_feedback;
create policy "manage own feedback" on public.guiliu_feedback for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "manage own ingest tokens" on public.guiliu_ingest_tokens;
create policy "manage own ingest tokens" on public.guiliu_ingest_tokens for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "manage own sources" on public.guiliu_sources;
create policy "manage own sources" on public.guiliu_sources for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.guiliu_ingest_cards(token text, cards jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  item jsonb;
  inserted_count int := 0;
  p_platform text;
  p_source text;
  p_video_key text;
  p_sources text[];
begin
  select user_id into owner_id
  from public.guiliu_ingest_tokens
  where token_hash = encode(digest(token, 'sha256'), 'hex')
    and revoked_at is null
  limit 1;

  if owner_id is null then
    raise exception 'invalid ingest token';
  end if;

  if jsonb_typeof(cards) <> 'array' then
    raise exception 'cards must be an array';
  end if;

  for item in select * from jsonb_array_elements(cards)
  loop
    p_platform := coalesce(nullif(item->>'platform', ''), 'unknown');
    p_source := coalesce(nullif(item->>'sourceType', ''), nullif(item->>'source_type', ''), 'manual');
    p_video_key := coalesce(nullif(item->>'videoKey', ''), nullif(item->>'video_key', ''), nullif(item->>'url', ''));
    p_sources := array[p_source];

    if p_video_key is null or coalesce(item->>'url', '') = '' or coalesce(item->>'title', '') = '' then
      continue;
    end if;

    insert into public.guiliu_feed_candidates (
      user_id, platform, source_type, sources, video_key, title, channel_name, channel_key,
      thumbnail_url, duration_text, published_text, view_count_text, url, embed_url, captured_at, updated_at
    ) values (
      owner_id,
      p_platform,
      p_source,
      p_sources,
      p_video_key,
      left(coalesce(item->>'title', '未命名视频'), 500),
      left(coalesce(item->>'channelName', item->>'channel_name', ''), 240),
      left(coalesce(item->>'channelKey', item->>'channel_key', item->>'channelName', item->>'channel_name', ''), 240),
      coalesce(item->>'thumbnailUrl', item->>'thumbnail_url', ''),
      left(coalesce(item->>'durationText', item->>'duration_text', ''), 80),
      left(coalesce(item->>'publishedText', item->>'published_text', ''), 120),
      left(coalesce(item->>'viewCountText', item->>'view_count_text', ''), 120),
      coalesce(item->>'url', ''),
      coalesce(item->>'embedUrl', item->>'embed_url', ''),
      coalesce((item->>'capturedAt')::timestamptz, now()),
      now()
    )
    on conflict (user_id, platform, video_key) do update set
      title = excluded.title,
      channel_name = excluded.channel_name,
      channel_key = excluded.channel_key,
      thumbnail_url = coalesce(nullif(excluded.thumbnail_url, ''), guiliu_feed_candidates.thumbnail_url),
      duration_text = coalesce(nullif(excluded.duration_text, ''), guiliu_feed_candidates.duration_text),
      published_text = coalesce(nullif(excluded.published_text, ''), guiliu_feed_candidates.published_text),
      view_count_text = coalesce(nullif(excluded.view_count_text, ''), guiliu_feed_candidates.view_count_text),
      url = excluded.url,
      embed_url = coalesce(nullif(excluded.embed_url, ''), guiliu_feed_candidates.embed_url),
      source_type = case when guiliu_feed_candidates.source_type = 'subscription' then 'subscription' else excluded.source_type end,
      sources = array(select distinct unnest(guiliu_feed_candidates.sources || excluded.sources)),
      updated_at = now();

    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object('count', inserted_count);
end;
$$;

grant execute on function public.guiliu_ingest_cards(text, jsonb) to anon, authenticated;
