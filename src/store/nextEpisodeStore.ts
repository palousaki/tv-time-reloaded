import { create } from 'zustand';
import { episodeKey } from '@/lib/watchProgress';
import { supabase } from '@/lib/supabase';
import { getSeasonDetails, getTvShowDetails, hasSeriesEnded } from '@/lib/tmdb';
import { useAuthStore } from '@/store/authStore';
import { useShowsStore } from '@/store/showsStore';
import type { Show } from '@/types';

export interface NextEpisode {
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  airDate: string | null;
  isPremiere: boolean;
  hasAired: boolean;
}

// No air date at all almost always means TMDB has an announced-but-unscheduled
// episode (common for an upcoming season) rather than missing historical data —
// a genuinely old, already-aired episode virtually always has a date on file.
function hasEpisodeAired(airDate: string | null): boolean {
  if (!airDate) return false;
  return new Date(airDate).getTime() <= Date.now();
}

type Entry =
  | { status: 'loading' }
  | { status: 'ready'; episode: NextEpisode | null; seriesEnded: boolean }
  | { status: 'error' };

interface NextEpisodeState {
  entries: Record<string, Entry>;
  load: (show: Show) => Promise<void>;
  markWatched: (show: Show) => Promise<void>;
  invalidate: (showId: string) => void;
}

interface NextEpisodeResult {
  episode: NextEpisode | null;
  seriesEnded: boolean;
}

// Regular seasons only (season 0 / specials are never "next" automatically).
// The actual episode_watches rows are the source of truth for what's watched
// (not shows.last_watched_season/episode, which only some code paths update),
// so this always reflects reality regardless of where an episode was toggled.
async function findNextEpisode(show: Show): Promise<NextEpisodeResult> {
  const [details, watchesRes] = await Promise.all([
    getTvShowDetails(show.tmdb_id),
    supabase.from('episode_watches').select('season_number, episode_number').eq('show_id', show.id),
  ]);

  if (watchesRes.error) throw new Error(watchesRes.error.message);
  const watched = new Set(
    (watchesRes.data ?? []).map((w) => episodeKey(w.season_number, w.episode_number))
  );

  const seriesEnded = hasSeriesEnded(details.status);

  const seasons = details.seasons
    .filter((s) => s.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number);

  let target: { seasonNumber: number; episodeNumber: number } | null = null;
  outer: for (const season of seasons) {
    for (let e = 1; e <= season.episode_count; e++) {
      if (!watched.has(episodeKey(season.season_number, e))) {
        target = { seasonNumber: season.season_number, episodeNumber: e };
        break outer;
      }
    }
  }
  if (!target) return { episode: null, seriesEnded };

  const seasonDetails = await getSeasonDetails(show.tmdb_id, target.seasonNumber);
  const episode = seasonDetails.episodes.find((e) => e.episode_number === target!.episodeNumber);
  if (!episode) return { episode: null, seriesEnded };

  return {
    episode: {
      seasonNumber: target.seasonNumber,
      episodeNumber: target.episodeNumber,
      name: episode.name,
      airDate: episode.air_date,
      isPremiere: target.episodeNumber === 1,
      hasAired: hasEpisodeAired(episode.air_date),
    },
    seriesEnded,
  };
}

export const useNextEpisodeStore = create<NextEpisodeState>((set, get) => ({
  entries: {},

  load: async (show) => {
    const existing = get().entries[show.id];
    if (existing && existing.status !== 'error') return;

    set((state) => ({ entries: { ...state.entries, [show.id]: { status: 'loading' } } }));
    try {
      const { episode, seriesEnded } = await findNextEpisode(show);
      set((state) => ({
        entries: { ...state.entries, [show.id]: { status: 'ready', episode, seriesEnded } },
      }));

      // Only auto-complete once the series itself has ended — being caught up
      // on a still-airing show just means waiting for the next episode.
      if (!episode && seriesEnded && show.status !== 'completed') {
        await useShowsStore.getState().updateShow(show.id, { status: 'completed' });
      }
    } catch {
      set((state) => ({ entries: { ...state.entries, [show.id]: { status: 'error' } } }));
    }
  },

  markWatched: async (show) => {
    const entry = get().entries[show.id];
    const episode = entry && entry.status === 'ready' ? entry.episode : (await findNextEpisode(show)).episode;
    if (!episode || !episode.hasAired) return;

    const userId = useAuthStore.getState().session?.user.id;
    if (!userId) return;

    const { error } = await supabase.from('episode_watches').upsert(
      {
        show_id: show.id,
        user_id: userId,
        season_number: episode.seasonNumber,
        episode_number: episode.episodeNumber,
      },
      { onConflict: 'show_id,season_number,episode_number' }
    );
    if (error) throw new Error(error.message);

    const updated = await useShowsStore.getState().updateShow(show.id, {
      last_watched_season: episode.seasonNumber,
      last_watched_episode: episode.episodeNumber,
      updated_at: new Date().toISOString(),
    });

    const { episode: nextEpisode, seriesEnded } = await findNextEpisode(updated);
    set((state) => ({
      entries: { ...state.entries, [show.id]: { status: 'ready', episode: nextEpisode, seriesEnded } },
    }));

    // Only auto-complete once the series itself has ended — being caught up
    // on a still-airing show just means waiting for the next episode.
    if (!nextEpisode && seriesEnded && updated.status !== 'completed') {
      await useShowsStore.getState().updateShow(show.id, { status: 'completed' });
    }
  },

  invalidate: (showId) =>
    set((state) => {
      if (!(showId in state.entries)) return state;
      const entries = { ...state.entries };
      delete entries[showId];
      return { entries };
    }),
}));
