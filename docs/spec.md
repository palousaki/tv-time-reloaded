# Project Spec

Build a personal, single-user mobile app (iOS/Android via Expo) for tracking
TV show watch progress — a lightweight replacement for TV Time (shutting down
July 15, 2026). The app must support importing existing watch history from a
TV Time GDPR data export (CSV files).

This is a **personal-use app**, not intended for the app store. Keep scope
minimal — no social features, no statistics dashboards, no push notifications.
"Upcoming episodes" is an explicit Phase 2 feature — do not build it now.

---

## Tech Stack

- **Expo + React Native** (TypeScript)
- **Zustand** for state management
- **Supabase** (Postgres + Auth) — used purely as a cloud backup/sync layer
- **AsyncStorage** for local cache (fast reads, offline-first UI)
- **TMDB API** (The Movie Database) for show/episode metadata
  - Free, non-commercial use — this project qualifies
  - Docs: https://developer.themoviedb.org/docs
  - Required attribution notice somewhere in the app (e.g. Settings screen):
    "This product uses the TMDB API but is not endorsed or certified by TMDB."

---

## Data Model (Supabase / Postgres)

```sql
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
```

Design notes:
- Rewatching an episode = `update` the existing row's `watched_at`, not a new
  row. No rewatch history tracking (out of scope).
- `total_episodes` is fetched from TMDB once when a show is added, used to
  auto-derive "completed" status.
- `tvtime_show_id` / `imported_from_tvtime` exist only to help debug/verify
  the import; not used elsewhere in the app.

---

## Screens (MVP)

1. **My Shows** — tabs: Watching / Completed / Dropped / Plan to Watch. Each
   row shows poster, name, and progress (e.g. "S3E4").
2. **Search** — search TMDB, add a show to the user's list (default status:
   `plan_to_watch` or `watching`, user's choice via a quick action).
3. **Show Detail** — season/episode list. Tapping an episode toggles
   watched/unwatched. A "mark up to here" bulk action marks all prior
   episodes in that season as watched.
4. **Import Review** (see below) — only shown once, right after the TV Time
   import runs.

Fetch fresh show/episode data from TMDB every time Show Detail is opened
(no local caching of episode lists beyond the current session) — this keeps
new episodes appearing automatically without any background job.

---

## TV Time Import

### Input files (from the TV Time GDPR export ZIP)

The user will provide these CSVs from their export:

- `followed_tv_show.csv` — columns: `tv_show_id, tv_show_name, archived,
  active, created_at, updated_at, ...`
- `user_tv_show_data.csv` — columns: `tv_show_id, tv_show_name,
  nb_episodes_seen, is_followed, is_favorited, ...`
- `show_seen_episode_latest.csv` — columns: `tv_show_id, tv_show_name,
  episode_id, created_at, updated_at, ...` (latest watched episode per show)
- `tracking-prod-records-v2.csv` — full per-episode watch history, columns
  include `ep_id, series_name, s_id, season_number, episode_number,
  created_at, ...` (optional — only needed if full episode-by-episode
  history is wanted; the other three files are sufficient for basic import)

### Status mapping logic

```
for each row in followed_tv_show.csv:
    if row.archived == 1:
        status = "dropped"
    else:
        # compare nb_episodes_seen (from user_tv_show_data.csv, joined on tv_show_id)
        # against total_episodes fetched from TMDB after matching
        if nb_episodes_seen >= total_episodes_from_tmdb:
            status = "completed"
        else:
            status = "watching"
```

Note: the `active` flag in `followed_tv_show.csv` has unknown/inconsistent
semantics based on manual inspection — do not use it for status derivation.

### TMDB matching algorithm

TV Time only provides `tv_show_name` (sometimes with a year suffix like
`"The Flash (2014)"`, `"Berlin (2023)"`) and an internal `tv_show_id` — no
direct TMDB or TheTVDB ID. Match by name:

```
for each show_name:
    year = extract "(YYYY)" suffix if present, else null
    clean_name = show_name with "(YYYY)" suffix stripped

    results = TMDB search/tv?query={clean_name}

    if year is not null:
        candidates = [r for r in results if abs(year(r.first_air_date) - year) <= 1]
    else:
        candidates = results

    if len(candidates) == 1:
        auto-match ✅
    elif len(candidates) == 0:
        flag as "no match" → needs manual review
    else:
        # multiple candidates — pick exact case-insensitive name match if only
        # one exists among candidates, else flag as "ambiguous" → needs manual review
```

### Import Review screen

After running the matching algorithm:
- Show a summary: "X shows auto-matched, Y need review"
- Auto-matched shows: one-tap "Confirm all" to commit them to Supabase
- Flagged shows (no match / ambiguous): show each with a small list of TMDB
  candidate results (poster + name + year) for the user to tap the correct
  one, or "skip this show"

### Post-import per-show fields to populate

- `tmdb_id` (from match)
- `name`, `poster_path`, `total_episodes` (from TMDB)
- `status` (from mapping logic above)
- `last_watched_season` / `last_watched_episode` (from
  `show_seen_episode_latest.csv`, mapped via the episode_id → season/episode
  lookup — if the episode_id itself doesn't carry season/episode info
  directly in that file, cross-reference `tracking-prod-records-v2.csv` by
  `ep_id`/`episode_id` to resolve season_number/episode_number)
- `tvtime_show_id` = original `tv_show_id`
- `imported_from_tvtime` = true

If time allows, also backfill `episode_watches` rows from
`tracking-prod-records-v2.csv` (one row per `episode_id` with resolved
season/episode numbers) so full watch history is preserved, not just the
"latest episode" pointer. This is a nice-to-have, not required for MVP —
the app is fully functional without full episode-level history, since
`last_watched_season`/`last_watched_episode` on the `shows` table is enough
to resume tracking going forward.

---

## Explicitly Out of Scope (Phase 2+)

- Upcoming episodes / air date tracking (TMDB's `next_episode_to_air` field
  already provides this — just not built into MVP yet)
- Statistics (hours watched, genre breakdown, etc.)
- Reminders / notifications
- Social features, sharing, comments
- Rewatch history (multiple watch dates per episode)

---

## Build Order Suggestion

1. Scaffold Expo project, set up Supabase project + run the schema above
2. Auth (simple email/magic link, single user)
3. TMDB API wrapper (search, get show details, get season/episode lists)
4. My Shows + Search + Show Detail screens working end-to-end for
   manually-added shows first
5. CSV import parser (can be built/tested as a standalone Node script before
   wiring into the app UI)
6. Import Review screen
7. Polish: loading states, error handling, offline fallback via AsyncStorage
