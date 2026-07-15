import type {
  TmdbSearchResult,
  TmdbSeasonDetails,
  TmdbShowDetails,
} from '@/types';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const accessToken = process.env.EXPO_PUBLIC_TMDB_ACCESS_TOKEN;

if (!accessToken) {
  throw new Error(
    'Missing EXPO_PUBLIC_TMDB_ACCESS_TOKEN. Copy .env.example to .env and add your TMDB API Read Access Token.'
  );
}

async function tmdbFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${TMDB_API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`TMDB request failed (${response.status}): ${path}`);
  }

  return response.json() as Promise<T>;
}

export function searchTvShows(query: string): Promise<{ results: TmdbSearchResult[] }> {
  return tmdbFetch('/search/tv', { query });
}

export function getTvShowDetails(tmdbId: number): Promise<TmdbShowDetails> {
  return tmdbFetch(`/tv/${tmdbId}`);
}

export function getSeasonDetails(
  tmdbId: number,
  seasonNumber: number
): Promise<TmdbSeasonDetails> {
  return tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`);
}

export function posterUrl(posterPath: string | null, size: 'w154' | 'w342' | 'w500' = 'w342') {
  if (!posterPath) return null;
  return `https://image.tmdb.org/t/p/${size}${posterPath}`;
}

// "Ended"/"Canceled" mean TMDB doesn't expect any more episodes, ever — as
// opposed to just being between seasons (still "Returning Series").
export function hasSeriesEnded(status: TmdbShowDetails['status']): boolean {
  return status === 'Ended' || status === 'Canceled';
}
