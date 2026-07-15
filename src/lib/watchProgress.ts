import type { TmdbSeasonSummary } from '@/types';

export function episodeKey(season: number, episode: number) {
  return `${season}-${episode}`;
}

// Specials (season 0) are excluded: a show counts as fully watched once every
// regular-season episode is watched, regardless of extras.
export function isFullyWatched(seasons: TmdbSeasonSummary[], watched: Set<string>): boolean {
  return seasons.every((season) => {
    if (season.season_number === 0) return true;
    for (let e = 1; e <= season.episode_count; e++) {
      if (!watched.has(episodeKey(season.season_number, e))) return false;
    }
    return true;
  });
}

export function watchedProgress(seasons: TmdbSeasonSummary[], watched: Set<string>) {
  let total = 0;
  let done = 0;
  for (const season of seasons) {
    if (season.season_number === 0) continue;
    total += season.episode_count;
    for (let e = 1; e <= season.episode_count; e++) {
      if (watched.has(episodeKey(season.season_number, e))) done++;
    }
  }
  return { done, total, percent: total > 0 ? done / total : 0 };
}
