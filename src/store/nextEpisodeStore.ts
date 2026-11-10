import { create } from 'zustand';
import { episodeKey } from '@/lib/watchProgress';
import { supabase } from '@/lib/supabase';
import { getSeasonDetails, getTvShowDetails, hasSeriesEnded } from '@/lib/tmdb';
import { useAuthStore } from '@/store/authStore';
import { useShowsStore } from '@/store/showsStore';
import type { Show, ShowStatus, TmdbEpisode, TmdbSeasonSummary, TmdbShowDetails } from '@/types';

export interface NextEpisode {
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  airDate: string | null;
  isPremiere: boolean;
  isFinale: boolean;
  hasAired: boolean;
  episodesRemaining: number;
}

// No air date at all almost always means TMDB has an announced-but-unscheduled
// episode (common for an upcoming season) rather than missing historical data —
// a genuinely old, already-aired episode virtually always has a date on file.
function hasEpisodeAired(airDate: string | null): boolean {
  if (!airDate) return false;
  return new Date(airDate).getTime() <= Date.now();
}

// Counts aired-but-unwatched episodes from `target` onward. Only fetches
// season details beyond the already-fetched target season, and stops at the
// first not-yet-aired episode it finds — episodes air in order, so nothing
// later could have aired already.
async function countEpisodesRemaining(
  tmdbId: number,
  seasons: TmdbSeasonSummary[],
  target: { seasonNumber: number; episodeNumber: number },
  targetSeasonEpisodes: TmdbEpisode[],
  watched: Set<string>
): Promise<number> {
  let remaining = 0;
  for (const season of seasons) {
    if (season.season_number < target.seasonNumber) continue;
    const episodes =
      season.season_number === target.seasonNumber
        ? targetSeasonEpisodes
        : (await getSeasonDetails(tmdbId, season.season_number)).episodes;

    for (const ep of episodes) {
      if (season.season_number === target.seasonNumber && ep.episode_number < target.episodeNumber) continue;
      if (watched.has(episodeKey(season.season_number, ep.episode_number))) continue;
      if (!hasEpisodeAired(ep.air_date)) return remaining;
      remaining++;
    }
  }
  return remaining;
}

// Per-show facts for the cards that have no "next episode" to show (Up to
// Date / Finished) — all derived from data findNextEpisode already fetches.
export interface ShowSummary {
  tmdbStatus: TmdbShowDetails['status'];
  seasonCount: number;
  episodeCount: number;
  // Rough total: TMDB's per-show average runtime × regular-season episodes.
  totalMinutes: number;
  firstAirYear: number | null;
  lastAirYear: number | null;
  lastWatched: { seasonNumber: number; episodeNumber: number } | null;
}

const DEFAULT_EPISODE_MINUTES = 45;

type Entry = { status: 'loading' } | ({ status: 'ready' } & NextEpisodeResult) | { status: 'error' };

// Everything `markWatched` changed, so `undoMarkWatched` can put it back —
// including an auto-flip to `completed` if that mark finished the series.
export interface MarkWatchedUndo {
  seasonNumber: number;
  episodeNumber: number;
  prevLastWatchedSeason: number | null;
  prevLastWatchedEpisode: number | null;
  prevStatus: ShowStatus;
  prevUpdatedAt: string;
}

interface NextEpisodeState {
  entries: Record<string, Entry>;
  load: (show: Show) => Promise<void>;
  markWatched: (show: Show) => Promise<MarkWatchedUndo | null>;
  undoMarkWatched: (show: Show, undo: MarkWatchedUndo) => Promise<void>;
  changeStatus: (show: Show, status: ShowStatus) => Promise<void>;
  invalidate: (showId: string) => void;
}

interface NextEpisodeResult {
  episode: NextEpisode | null;
  seriesEnded: boolean;
  // Most recent episode_watches.watched_at for the show — the real "last
  // watched" signal, unlike shows.updated_at which any edit bumps.
  lastWatchedAt: string | null;
  summary: ShowSummary;
}

function airYear(date: string | null) {
  return date ? Number(date.slice(0, 4)) : null;
}

// Regular seasons only (season 0 / specials are never "next" automatically).
// The actual episode_watches rows are the source of truth for what's watched
// (not shows.last_watched_season/episode, which only some code paths update),
// so this always reflects reality regardless of where an episode was toggled.
async function findNextEpisode(show: Show): Promise<NextEpisodeResult> {
  const [details, watchesRes] = await Promise.all([
    getTvShowDetails(show.tmdb_id),
    supabase
      .from('episode_watches')
      .select('season_number, episode_number, watched_at')
      .eq('show_id', show.id),
  ]);

  if (watchesRes.error) throw new Error(watchesRes.error.message);
  const watched = new Set(
    (watchesRes.data ?? []).map((w) => episodeKey(w.season_number, w.episode_number))
  );

  const seriesEnded = hasSeriesEnded(details.status);

  // Latest watch by time; ties (bulk "mark up to here" rows share one
  // timestamp) go to the furthest episode, which is the one you'd call "last".
  let lastWatchedAt: string | null = null;
  let lastWatched: ShowSummary['lastWatched'] = null;
  for (const w of watchesRes.data ?? []) {
    const t = new Date(w.watched_at).getTime();
    const best = lastWatchedAt ? new Date(lastWatchedAt).getTime() : -Infinity;
    const furtherOnTie =
      t === best &&
      lastWatched !== null &&
      (w.season_number > lastWatched.seasonNumber ||
        (w.season_number === lastWatched.seasonNumber && w.episode_number > lastWatched.episodeNumber));
    if (t > best || furtherOnTie) {
      lastWatchedAt = w.watched_at;
      lastWatched = { seasonNumber: w.season_number, episodeNumber: w.episode_number };
    }
  }

  const seasons = details.seasons
    .filter((s) => s.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number);

  const runtimes = details.episode_run_time ?? [];
  const avgRuntime =
    runtimes.length > 0 ? runtimes.reduce((a, b) => a + b, 0) / runtimes.length : DEFAULT_EPISODE_MINUTES;
  const episodeCount = seasons.reduce((sum, s) => sum + s.episode_count, 0);
  const summary: ShowSummary = {
    tmdbStatus: details.status,
    seasonCount: seasons.length,
    episodeCount,
    totalMinutes: Math.round(avgRuntime * episodeCount),
    firstAirYear: airYear(details.first_air_date),
    lastAirYear: airYear(details.last_air_date),
    lastWatched,
  };

  let target: { seasonNumber: number; episodeNumber: number } | null = null;
  outer: for (const season of seasons) {
    for (let e = 1; e <= season.episode_count; e++) {
      if (!watched.has(episodeKey(season.season_number, e))) {
        target = { seasonNumber: season.season_number, episodeNumber: e };
        break outer;
      }
    }
  }
  if (!target) return { episode: null, seriesEnded, lastWatchedAt, summary };

  const seasonDetails = await getSeasonDetails(show.tmdb_id, target.seasonNumber);
  const episode = seasonDetails.episodes.find((e) => e.episode_number === target!.episodeNumber);
  if (!episode) return { episode: null, seriesEnded, lastWatchedAt, summary };

  const isFinale =
    target.episodeNumber === Math.max(...seasonDetails.episodes.map((e) => e.episode_number));

  const episodesRemaining = await countEpisodesRemaining(
    show.tmdb_id,
    seasons,
    target,
    seasonDetails.episodes,
    watched
  );

  return {
    episode: {
      seasonNumber: target.seasonNumber,
      episodeNumber: target.episodeNumber,
      name: episode.name,
      airDate: episode.air_date,
      isPremiere: target.episodeNumber === 1,
      isFinale,
      hasAired: hasEpisodeAired(episode.air_date),
      episodesRemaining,
    },
    seriesEnded,
    lastWatchedAt,
    summary,
  };
}

export const useNextEpisodeStore = create<NextEpisodeState>((set, get) => ({
  entries: {},

  load: async (show) => {
    const existing = get().entries[show.id];
    if (existing && existing.status !== 'error') return;

    set((state) => ({ entries: { ...state.entries, [show.id]: { status: 'loading' } } }));
    try {
      const result = await findNextEpisode(show);
      const { episode, seriesEnded } = result;
      set((state) => ({
        entries: { ...state.entries, [show.id]: { status: 'ready', ...result } },
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
    if (!episode || !episode.hasAired) return null;

    const userId = useAuthStore.getState().session?.user.id;
    if (!userId) return null;

    const undo: MarkWatchedUndo = {
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      prevLastWatchedSeason: show.last_watched_season,
      prevLastWatchedEpisode: show.last_watched_episode,
      prevStatus: show.status,
      prevUpdatedAt: show.updated_at,
    };

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

    const result = await findNextEpisode(updated);
    const { episode: nextEpisode, seriesEnded } = result;
    set((state) => ({
      entries: { ...state.entries, [show.id]: { status: 'ready', ...result } },
    }));

    // Only auto-complete once the series itself has ended — being caught up
    // on a still-airing show just means waiting for the next episode.
    if (!nextEpisode && seriesEnded && updated.status !== 'completed') {
      await useShowsStore.getState().updateShow(show.id, { status: 'completed' });
    }

    return undo;
  },

  undoMarkWatched: async (show, undo) => {
    const { error } = await supabase
      .from('episode_watches')
      .delete()
      .eq('show_id', show.id)
      .eq('season_number', undo.seasonNumber)
      .eq('episode_number', undo.episodeNumber);
    if (error) throw new Error(error.message);

    const restored = await useShowsStore.getState().updateShow(show.id, {
      last_watched_season: undo.prevLastWatchedSeason,
      last_watched_episode: undo.prevLastWatchedEpisode,
      status: undo.prevStatus,
      updated_at: undo.prevUpdatedAt,
    });

    const result = await findNextEpisode(restored);
    set((state) => ({
      entries: { ...state.entries, [show.id]: { status: 'ready', ...result } },
    }));
  },

  // Mirrors the detail screen's status change: marking a show Finished
  // bulk-fills every unwatched regular-season episode so the status and the
  // episode checkmarks don't disagree.
  changeStatus: async (show, status) => {
    if (status === 'completed') {
      const userId = useAuthStore.getState().session?.user.id;
      if (!userId) throw new Error('Not signed in');

      const [details, watchesRes] = await Promise.all([
        getTvShowDetails(show.tmdb_id),
        supabase.from('episode_watches').select('season_number, episode_number').eq('show_id', show.id),
      ]);
      if (watchesRes.error) throw new Error(watchesRes.error.message);
      const watched = new Set(
        (watchesRes.data ?? []).map((w) => episodeKey(w.season_number, w.episode_number))
      );

      const pairs: { season_number: number; episode_number: number }[] = [];
      for (const season of details.seasons) {
        if (season.season_number === 0) continue;
        for (let e = 1; e <= season.episode_count; e++) {
          if (!watched.has(episodeKey(season.season_number, e))) {
            pairs.push({ season_number: season.season_number, episode_number: e });
          }
        }
      }

      if (pairs.length > 0) {
        const { error } = await supabase
          .from('episode_watches')
          .insert(pairs.map((p) => ({ ...p, show_id: show.id, user_id: userId })));
        if (error) throw new Error(error.message);
      }
    }

    await useShowsStore.getState().updateShow(show.id, { status });
    get().invalidate(show.id);
  },

  invalidate: (showId) =>
    set((state) => {
      if (!(showId in state.entries)) return state;
      const entries = { ...state.entries };
      delete entries[showId];
      return { entries };
    }),
}));
