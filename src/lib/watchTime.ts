import { getTvShowDetails } from '@/lib/tmdb';
import { supabase } from '@/lib/supabase';
import type { Show } from '@/types';

const DEFAULT_EPISODE_MINUTES = 45;

const PAGE_SIZE = 1000;

// Supabase caps unpaginated selects at a server-side max row count, so a
// single .select() silently truncates once episode_watches passes that
// threshold — page through with .range() to get the true total.
async function fetchAllEpisodeWatchShowIds(): Promise<string[]> {
  const showIds: string[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('episode_watches')
      .select('show_id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) showIds.push(row.show_id);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return showIds;
}

// TMDB's episode_run_time is a per-show average (often just one value), not
// per-episode, so this is an approximation — good enough for a rough total.
export async function computeTotalWatchMinutes(shows: Show[]): Promise<number> {
  const showIds = await fetchAllEpisodeWatchShowIds();

  const countByShowId = new Map<string, number>();
  for (const showId of showIds) {
    countByShowId.set(showId, (countByShowId.get(showId) ?? 0) + 1);
  }

  const showById = new Map(shows.map((s) => [s.id, s]));

  const totals = await Promise.all(
    Array.from(countByShowId.entries()).map(async ([showId, count]) => {
      const show = showById.get(showId);
      if (!show) return 0;
      try {
        const details = await getTvShowDetails(show.tmdb_id);
        const runtimes = details.episode_run_time ?? [];
        const avg =
          runtimes.length > 0 ? runtimes.reduce((a, b) => a + b, 0) / runtimes.length : DEFAULT_EPISODE_MINUTES;
        return avg * count;
      } catch {
        return DEFAULT_EPISODE_MINUTES * count;
      }
    })
  );

  return Math.round(totals.reduce((a, b) => a + b, 0));
}

export interface WatchTimeBreakdown {
  months: number;
  days: number;
  hours: number;
}

export function formatWatchTime(totalMinutes: number): WatchTimeBreakdown {
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);
  const months = Math.floor(totalDays / 30);
  return {
    months,
    days: totalDays % 30,
    hours: totalHours % 24,
  };
}
