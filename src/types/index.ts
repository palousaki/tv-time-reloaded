export type ShowStatus = 'watching' | 'completed' | 'dropped' | 'plan_to_watch';

export interface Show {
  id: string;
  user_id: string;

  tmdb_id: number;
  name: string;
  poster_path: string | null;
  total_episodes: number | null;

  status: ShowStatus;

  last_watched_season: number | null;
  last_watched_episode: number | null;

  created_at: string;
  updated_at: string;
}

export interface EpisodeWatch {
  id: string;
  show_id: string;
  user_id: string;

  season_number: number;
  episode_number: number;
  watched_at: string;
}

export interface TmdbSearchResult {
  id: number;
  name: string;
  poster_path: string | null;
  first_air_date: string | null;
}

export interface TmdbShowDetails {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  first_air_date: string | null;
  last_air_date: string | null;
  number_of_episodes: number;
  number_of_seasons: number;
  episode_run_time: number[];
  genres: { id: number; name: string }[];
  vote_average: number;
  seasons: TmdbSeasonSummary[];
  status: 'Ended' | 'Canceled' | 'Returning Series' | 'In Production' | 'Planned' | 'Pilot';
}

export interface TmdbSeasonSummary {
  season_number: number;
  episode_count: number;
  name: string;
}

export interface TmdbEpisode {
  id: number;
  season_number: number;
  episode_number: number;
  name: string;
  air_date: string | null;
}

export interface TmdbSeasonDetails {
  season_number: number;
  episodes: TmdbEpisode[];
}
