# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Current Status

Done:
- Expo Router scaffold: tabs (My Shows / Search / Settings) plus `show/[id]`
  route.
- `src/lib/supabase.ts` (Supabase client) and `src/lib/tmdb.ts` (TMDB wrapper).
- `src/store/showsStore.ts` (Zustand: fetch/add/update `shows`).
- `src/constants/colors.ts` — all screen colors go through this, not raw hex.
- Supabase schema applied (`supabase/migrations/0001_init.sql`). Note: the
  `shows` table still has unused `tvtime_show_id`/`imported_from_tvtime`
  columns left over from the removed TV Time CSV import feature — harmless,
  not written to or read by the app anymore.
- Android dev client build working via `expo run:android`.
- Auth: email magic link via Supabase Auth (`src/store/authStore.ts`,
  `src/hooks/useAuthDeepLink.ts`, `app/sign-in.tsx`), gating `(tabs)` /
  `show/[id]` behind `Stack.Protected` in `app/_layout.tsx`.
  Single user — `shouldCreateUser: false`, the one Supabase Auth user is
  created manually in the dashboard (see README Setup step 5).
- Search screen inserts a `shows` row on tap (status `watching` or
  `plan_to_watch` via an action sheet), fetching `total_episodes` from TMDB
  at add-time, then navigates to the new show's detail screen.
- Show Detail screen: status selector, season accordion fetching
  episodes from TMDB live per-season (session-only cache, no persistence),
  per-episode watched toggle, and "mark up to here" bulk action that writes
  `episode_watches` rows and updates `last_watched_season`/`last_watched_episode`.
- My Shows has 5 tabs: Watching, Up to Date, Finished, Dropped, Plan to Watch.
  "Watching" and "Up to Date" are both the `watching` `ShowStatus` under the
  hood — split at render time in `app/(tabs)/index.tsx` by whether
  `useNextEpisodeStore` found an unwatched episode for the show, not by a
  stored column. "Finished" is the `completed` status, renamed in the UI;
  `src/store/nextEpisodeStore.ts`'s `load`/`markWatched` only auto-flip a show
  to `completed` once TMDB's own `status` field (via `hasSeriesEnded` in
  `src/lib/tmdb.ts`) says the series itself has ended — being caught up on a
  still-airing show no longer gets misclassified as finished.

# Next Steps (suggested order)

1. Polish: loading states, error handling, offline fallback via AsyncStorage.

# Windows Build Note

`android/` is gitignored (Expo regenerates it via prebuild). If it's ever
deleted/regenerated, re-apply the CMake pin in `android/app/build.gradle`:

```
externalNativeBuild {
    cmake {
        version "3.31.6"
    }
}
```

Without it, native builds fail with a ninja "Filename longer than 260
characters" error from `react-native-gesture-handler`'s codegen — a Windows
path-length limit that CMake 3.31 works around (hashes long object paths)
but the SDK's default bundled CMake 3.22.1 does not. Requires CMake 3.31.6
installed via Android Studio's SDK Manager (SDK Tools tab).
