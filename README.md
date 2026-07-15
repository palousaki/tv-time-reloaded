# TV Time Reloaded

Personal TV show watch tracker (Expo/React Native), replacing
TV Time.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Create a Supabase project, then run the migration in
   `supabase/migrations/0001_init.sql` against it (SQL editor or `supabase db push`).

3. Get a TMDB API Read Access Token from
   https://www.themoviedb.org/settings/api (free, non-commercial use).

4. Copy `.env.example` to `.env` and fill in:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_TMDB_ACCESS_TOKEN`

5. In the Supabase dashboard, set up auth (this app is single-user, sign-up
   is disabled):
   - Auth → Users → add one user with the email you'll sign in with.
   - Auth → URL Configuration → add `tvtimereloaded://**` as a redirect URL
     (needed for the magic-link email to open back into the app).
   - Optionally, edit that user's raw user metadata to add
     `{ "display_name": "Your Name" }` — Settings shows this instead of your
     email when set.

6. Start the app:
   ```
   npm start
   ```

## Project structure

- `app/` — expo-router screens (file-based routing)
- `src/lib/supabase.ts` — Supabase client
- `src/lib/tmdb.ts` — TMDB API wrapper
- `src/store/` — Zustand stores
- `src/types/` — shared TypeScript types matching the Supabase schema
- `supabase/migrations/` — SQL schema
