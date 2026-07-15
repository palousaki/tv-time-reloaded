import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { getTvShowDetails } from '@/lib/tmdb';
import { useAuthStore } from '@/store/authStore';
import type { Show, ShowStatus } from '@/types';

interface ShowsState {
  shows: Show[];
  loading: boolean;
  error: string | null;
  fetchShows: () => Promise<void>;
  addShow: (tmdbId: number, status: ShowStatus) => Promise<Show>;
  updateShow: (id: string, patch: Partial<Show>) => Promise<Show>;
  deleteShow: (id: string) => Promise<void>;
}

export const useShowsStore = create<ShowsState>((set) => ({
  shows: [],
  loading: true,
  error: null,

  fetchShows: async () => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('shows')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }

    set({ shows: (data ?? []) as Show[], loading: false });
  },

  addShow: async (tmdbId, status) => {
    const userId = useAuthStore.getState().session?.user.id;
    if (!userId) throw new Error('Not signed in');

    const details = await getTvShowDetails(tmdbId);
    const { data, error } = await supabase
      .from('shows')
      .insert({
        user_id: userId,
        tmdb_id: tmdbId,
        name: details.name,
        poster_path: details.poster_path,
        total_episodes: details.number_of_episodes,
        status,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        const { data: existing, error: lookupError } = await supabase
          .from('shows')
          .select('*')
          .eq('user_id', userId)
          .eq('tmdb_id', tmdbId)
          .single();
        if (lookupError) throw new Error(lookupError.message);
        return existing as Show;
      }
      throw new Error(error.message);
    }

    const show = data as Show;
    set((state) => ({ shows: [show, ...state.shows] }));
    return show;
  },

  updateShow: async (id, patch) => {
    const { data, error } = await supabase
      .from('shows')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    const show = data as Show;
    set((state) => ({ shows: state.shows.map((s) => (s.id === id ? show : s)) }));
    return show;
  },

  deleteShow: async (id) => {
    const { error } = await supabase.from('shows').delete().eq('id', id);
    if (error) throw new Error(error.message);
    set((state) => ({ shows: state.shows.filter((s) => s.id !== id) }));
  },
}));
