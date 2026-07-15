-- ============================================
-- SHOWS
-- ============================================
create table shows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  tmdb_id integer not null,
  name text not null,
  poster_path text,
  total_episodes integer,

  status text not null default 'watching'
    check (status in ('watching', 'completed', 'dropped', 'plan_to_watch')),

  last_watched_season integer,
  last_watched_episode integer,

  tvtime_show_id integer,
  imported_from_tvtime boolean default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, tmdb_id)
);

create index idx_shows_user_status on shows(user_id, status);

-- ============================================
-- EPISODE_WATCHES
-- ============================================
create table episode_watches (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  season_number integer not null,
  episode_number integer not null,
  watched_at timestamptz not null default now(),

  unique (show_id, season_number, episode_number)
);

create index idx_episode_watches_show on episode_watches(show_id);

-- ============================================
-- RLS
-- ============================================
alter table shows enable row level security;
alter table episode_watches enable row level security;

create policy "Users manage their own shows"
  on shows for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own episode watches"
  on episode_watches for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
