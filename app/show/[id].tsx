import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { getSeasonDetails, getTvShowDetails, hasSeriesEnded, posterUrl } from '@/lib/tmdb';
import { episodeKey, isFullyWatched, watchedProgress } from '@/lib/watchProgress';
import { useAuthStore } from '@/store/authStore';
import { showDialog } from '@/store/dialogStore';
import { useNextEpisodeStore } from '@/store/nextEpisodeStore';
import { useShowsStore } from '@/store/showsStore';
import type { Show, ShowStatus, TmdbEpisode, TmdbSeasonSummary } from '@/types';

const STATUS_OPTIONS: { key: ShowStatus; label: string }[] = [
  { key: 'watching', label: 'Watching' },
  { key: 'completed', label: 'Finished' },
  { key: 'dropped', label: 'Dropped' },
  { key: 'plan_to_watch', label: 'Plan to Watch' },
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

// TMDB's own `season.name` is inconsistently branded per-season for some shows
// (e.g. Stranger Things: "Season 1" then "Stranger Things 2", "Stranger Things 3"),
// so we render a normalized label instead.
function seasonLabel(season: TmdbSeasonSummary) {
  return season.season_number === 0 ? 'Specials' : `Season ${season.season_number}`;
}

export default function ShowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const updateShow = useShowsStore((state) => state.updateShow);
  const deleteShow = useShowsStore((state) => state.deleteShow);
  const [deleting, setDeleting] = useState(false);

  const [show, setShow] = useState<Show | null>(null);
  const [seriesEnded, setSeriesEnded] = useState(false);
  const [seasons, setSeasons] = useState<TmdbSeasonSummary[]>([]);
  const [episodesBySeason, setEpisodesBySeason] = useState<Record<number, TmdbEpisode[]>>({});
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [loadingSeason, setLoadingSeason] = useState<number | null>(null);
  const [togglingSeason, setTogglingSeason] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    loadAll(id);
  }, [id]);

  async function loadAll(showId: string) {
    setLoading(true);
    setError(null);
    try {
      const { data: showData, error: showError } = await supabase
        .from('shows')
        .select('*')
        .eq('id', showId)
        .single();
      if (showError) throw new Error(showError.message);
      const showRow = showData as Show;
      setShow(showRow);

      const [details, watchesRes] = await Promise.all([
        getTvShowDetails(showRow.tmdb_id),
        supabase.from('episode_watches').select('season_number, episode_number').eq('show_id', showId),
      ]);

      setSeasons([...details.seasons].sort((a, b) => a.season_number - b.season_number));
      setSeriesEnded(hasSeriesEnded(details.status));

      if (watchesRes.error) throw new Error(watchesRes.error.message);
      setWatched(
        new Set((watchesRes.data ?? []).map((w) => episodeKey(w.season_number, w.episode_number)))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load show');
    } finally {
      setLoading(false);
    }
  }

  async function syncCompletionStatus(nextWatched: Set<string>) {
    if (!show) return;
    const fullyWatched = isFullyWatched(seasons, nextWatched);
    // Only auto-complete once the series itself has ended — being caught up
    // on a still-airing show just means waiting for the next episode.
    if (fullyWatched && seriesEnded && show.status !== 'completed') {
      const updated = await updateShow(show.id, { status: 'completed' });
      setShow(updated);
    } else if (!fullyWatched && show.status === 'completed') {
      const updated = await updateShow(show.id, { status: 'watching' });
      setShow(updated);
    }
  }

  async function ensureSeasonEpisodes(seasonNumber: number): Promise<TmdbEpisode[]> {
    const cached = episodesBySeason[seasonNumber];
    if (cached) return cached;
    if (!show) return [];
    const details = await getSeasonDetails(show.tmdb_id, seasonNumber);
    setEpisodesBySeason((prev) => ({ ...prev, [seasonNumber]: details.episodes }));
    return details.episodes;
  }

  async function toggleSeason(seasonNumber: number) {
    if (expandedSeason === seasonNumber) {
      setExpandedSeason(null);
      return;
    }
    setExpandedSeason(seasonNumber);
    if (episodesBySeason[seasonNumber]) return;

    setLoadingSeason(seasonNumber);
    try {
      await ensureSeasonEpisodes(seasonNumber);
    } catch (err) {
      showDialog('Failed to load season', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoadingSeason(null);
    }
  }

  async function toggleEpisode(seasonNumber: number, episodeNumber: number) {
    if (!show) return;
    const userId = useAuthStore.getState().session?.user.id;
    if (!userId) return;

    const key = episodeKey(seasonNumber, episodeNumber);
    const wasWatched = watched.has(key);

    const nextWatched = new Set(watched);
    if (wasWatched) nextWatched.delete(key);
    else nextWatched.add(key);
    setWatched(nextWatched);

    const { error: mutationError } = wasWatched
      ? await supabase
          .from('episode_watches')
          .delete()
          .eq('show_id', show.id)
          .eq('season_number', seasonNumber)
          .eq('episode_number', episodeNumber)
      : await supabase.from('episode_watches').insert({
          show_id: show.id,
          user_id: userId,
          season_number: seasonNumber,
          episode_number: episodeNumber,
        });

    if (mutationError) {
      setWatched(watched);
      showDialog('Failed to update episode', mutationError.message);
      return;
    }

    useNextEpisodeStore.getState().invalidate(show.id);
    await syncCompletionStatus(nextWatched);
  }

  async function toggleSeasonAll(season: TmdbSeasonSummary) {
    if (!show || togglingSeason != null) return;
    const userId = useAuthStore.getState().session?.user.id;
    if (!userId) return;

    setTogglingSeason(season.season_number);
    try {
      const episodes = await ensureSeasonEpisodes(season.season_number);
      const allWatched = episodes.every((ep) =>
        watched.has(episodeKey(season.season_number, ep.episode_number))
      );

      const nextWatched = new Set(watched);
      if (allWatched) {
        for (const ep of episodes) nextWatched.delete(episodeKey(season.season_number, ep.episode_number));
      } else {
        for (const ep of episodes) nextWatched.add(episodeKey(season.season_number, ep.episode_number));
      }
      setWatched(nextWatched);

      const { error: mutationError } = allWatched
        ? await supabase
            .from('episode_watches')
            .delete()
            .eq('show_id', show.id)
            .eq('season_number', season.season_number)
        : await supabase.from('episode_watches').upsert(
            episodes.map((ep) => ({
              show_id: show.id,
              user_id: userId,
              season_number: season.season_number,
              episode_number: ep.episode_number,
            })),
            { onConflict: 'show_id,season_number,episode_number' }
          );

      if (mutationError) {
        setWatched(watched);
        showDialog('Failed to update season', mutationError.message);
        return;
      }

      useNextEpisodeStore.getState().invalidate(show.id);
      await syncCompletionStatus(nextWatched);
    } catch (err) {
      showDialog('Failed to update season', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setTogglingSeason(null);
    }
  }

  async function markUpToHere(seasonNumber: number, episodeNumber: number) {
    if (!show) return;
    const userId = useAuthStore.getState().session?.user.id;
    if (!userId) return;

    const pairs: { season_number: number; episode_number: number }[] = [];
    for (const season of seasons) {
      if (season.season_number === 0 || season.season_number > seasonNumber) continue;
      const maxEpisode = season.season_number === seasonNumber ? episodeNumber : season.episode_count;
      for (let e = 1; e <= maxEpisode; e++) {
        if (!watched.has(episodeKey(season.season_number, e))) {
          pairs.push({ season_number: season.season_number, episode_number: e });
        }
      }
    }
    if (pairs.length === 0) return;

    const nextWatched = new Set(watched);
    pairs.forEach((p) => nextWatched.add(episodeKey(p.season_number, p.episode_number)));
    setWatched(nextWatched);

    const { error: insertError } = await supabase
      .from('episode_watches')
      .insert(pairs.map((p) => ({ ...p, show_id: show.id, user_id: userId })));

    if (insertError) {
      showDialog('Failed to update progress', insertError.message);
      return;
    }

    try {
      const updated = await updateShow(show.id, {
        last_watched_season: seasonNumber,
        last_watched_episode: episodeNumber,
      });
      setShow(updated);
    } catch (err) {
      showDialog('Failed to save progress', err instanceof Error ? err.message : 'Unknown error');
    }

    useNextEpisodeStore.getState().invalidate(show.id);
    await syncCompletionStatus(nextWatched);
  }

  async function handleStatusChange(status: ShowStatus) {
    if (!show) return;
    const userId = useAuthStore.getState().session?.user.id;
    if (!userId) return;

    try {
      // Marking a show Completed implies every regular-season episode was
      // seen (specials aside) — bulk-fill any gaps rather than leaving the
      // status and episode checkmarks out of sync.
      if (status === 'completed') {
        const pairs: { season_number: number; episode_number: number }[] = [];
        for (const season of seasons) {
          if (season.season_number === 0) continue;
          for (let e = 1; e <= season.episode_count; e++) {
            if (!watched.has(episodeKey(season.season_number, e))) {
              pairs.push({ season_number: season.season_number, episode_number: e });
            }
          }
        }

        if (pairs.length > 0) {
          const { error: insertError } = await supabase
            .from('episode_watches')
            .insert(pairs.map((p) => ({ ...p, show_id: show.id, user_id: userId })));
          if (insertError) throw new Error(insertError.message);

          const nextWatched = new Set(watched);
          pairs.forEach((p) => nextWatched.add(episodeKey(p.season_number, p.episode_number)));
          setWatched(nextWatched);
        }
      }

      const updated = await updateShow(show.id, { status });
      setShow(updated);
      useNextEpisodeStore.getState().invalidate(show.id);
    } catch (err) {
      showDialog('Failed to update status', err instanceof Error ? err.message : 'Unknown error');
    }
  }

  function handleDeletePress() {
    if (!show) return;
    showDialog(
      'Delete show?',
      `This removes "${show.name}" and its watch history. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: handleDeleteConfirm },
      ]
    );
  }

  async function handleDeleteConfirm() {
    if (!show) return;
    setDeleting(true);
    try {
      await deleteShow(show.id);
      router.back();
    } catch (err) {
      setDeleting(false);
      showDialog('Failed to delete show', err instanceof Error ? err.message : 'Unknown error');
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  if (error || !show) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Show not found'}</Text>
      </View>
    );
  }

  const regularSeasons = seasons.filter((s) => s.season_number > 0);
  const progress = watchedProgress(seasons, watched);
  const fullyWatched = isFullyWatched(seasons, watched);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Image
          source={{ uri: posterUrl(show.poster_path, 'w500') ?? undefined }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
        <View style={styles.heroScrim} />
        <View style={styles.heroContent}>
          <Text style={styles.name}>{show.name}</Text>
          <Text style={styles.meta}>
            {regularSeasons.length} season{regularSeasons.length === 1 ? '' : 's'}
          </Text>
          {fullyWatched && (
            <View style={[styles.caughtUpBadge, seriesEnded && styles.finishedBadge]}>
              <Text style={[styles.caughtUpBadgeText, seriesEnded && styles.finishedBadgeText]}>
                {seriesEnded ? 'SERIES FINISHED' : 'UP TO DATE'}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.progressSection}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress.percent * 100)}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {Math.round(progress.percent * 100)}% · {progress.done}/{progress.total} episodes
        </Text>
      </View>

      <View style={styles.statusRow}>
        {STATUS_OPTIONS.map((opt) => (
          <Pressable
            key={opt.key}
            onPress={() => handleStatusChange(opt.key)}
            style={[styles.statusPill, show.status === opt.key && styles.statusPillActive]}
          >
            <Text style={[styles.statusLabel, show.status === opt.key && styles.statusLabelActive]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {seasons.map((season) => {
        const episodes = episodesBySeason[season.season_number];
        const isExpanded = expandedSeason === season.season_number;

        let watchedCount = 0;
        for (let e = 1; e <= season.episode_count; e++) {
          if (watched.has(episodeKey(season.season_number, e))) watchedCount++;
        }
        const seasonComplete = season.episode_count > 0 && watchedCount === season.episode_count;
        const seasonStarted = watchedCount > 0;
        const isToggling = togglingSeason === season.season_number;

        return (
          <View key={season.season_number} style={styles.season}>
            <Pressable style={styles.seasonHeader} onPress={() => toggleSeason(season.season_number)}>
              <View style={styles.seasonHeaderText}>
                <Text style={styles.seasonTitle}>{seasonLabel(season)}</Text>
                <Text style={styles.seasonProgress}>
                  {watchedCount}/{season.episode_count}
                </Text>
              </View>
              <Pressable
                style={[
                  styles.seasonCheck,
                  seasonComplete && styles.seasonCheckComplete,
                  !seasonComplete && seasonStarted && styles.seasonCheckPartial,
                ]}
                onPress={() => toggleSeasonAll(season)}
                disabled={isToggling}
                hitSlop={8}
              >
                {isToggling ? (
                  <ActivityIndicator size="small" color={Colors.textPrimary} />
                ) : (
                  <Ionicons
                    name="checkmark"
                    size={16}
                    color={seasonComplete ? Colors.background : Colors.textMuted}
                  />
                )}
              </Pressable>
            </Pressable>
            <View style={styles.seasonBarTrack}>
              <View
                style={[
                  styles.seasonBarFill,
                  { width: `${season.episode_count > 0 ? (watchedCount / season.episode_count) * 100 : 0}%` },
                  seasonComplete ? styles.seasonBarComplete : styles.seasonBarPartial,
                ]}
              />
            </View>

            {isExpanded &&
              (loadingSeason === season.season_number ? (
                <ActivityIndicator style={styles.seasonLoading} color={Colors.accent} />
              ) : (
                (episodes ?? []).map((ep) => {
                  const epWatched = watched.has(episodeKey(season.season_number, ep.episode_number));
                  return (
                    <View key={ep.id} style={styles.episodeRow}>
                      <Pressable
                        style={styles.episodeCheckArea}
                        onPress={() => toggleEpisode(season.season_number, ep.episode_number)}
                      >
                        <View style={[styles.checkbox, epWatched && styles.checkboxChecked]}>
                          {epWatched && <Ionicons name="checkmark" size={12} color={Colors.background} />}
                        </View>
                        <Text style={styles.episodeName} numberOfLines={1}>
                          E{ep.episode_number} · {ep.name}
                        </Text>
                      </Pressable>
                      {season.season_number > 0 && (
                        <Pressable onPress={() => markUpToHere(season.season_number, ep.episode_number)}>
                          <Text style={styles.markLink}>Mark up to here</Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })
              ))}
          </View>
        );
      })}

      <Pressable
        style={[styles.deleteButton, deleting && styles.deleteButtonDisabled]}
        onPress={handleDeletePress}
        disabled={deleting}
      >
        {deleting ? (
          <ActivityIndicator color={Colors.error} />
        ) : (
          <Text style={styles.deleteButtonText}>Delete Show</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: Colors.background },
  container: { paddingBottom: 32, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: Colors.background },
  error: { color: Colors.error, fontSize: 15 },
  hero: { height: 260, backgroundColor: Colors.placeholder, justifyContent: 'flex-end' },
  heroScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  heroContent: { padding: 16, gap: 4 },
  name: { fontSize: 24, fontWeight: '700', color: Colors.textPrimary },
  meta: { fontSize: 14, color: Colors.textSecondary },
  caughtUpBadge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  caughtUpBadgeText: { color: Colors.accent, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  finishedBadge: { backgroundColor: Colors.success, borderColor: Colors.success },
  finishedBadgeText: { color: Colors.background },
  progressSection: { paddingHorizontal: 16, gap: 6 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceAlt, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: 3 },
  progressText: { fontSize: 12, color: Colors.textMuted },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  statusPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: Colors.surface,
  },
  statusPillActive: { backgroundColor: Colors.accent },
  statusLabel: { color: Colors.inactiveText, fontSize: 13 },
  statusLabelActive: { color: Colors.accentText, fontWeight: '600' },
  season: { gap: 6, paddingHorizontal: 16 },
  seasonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    backgroundColor: Colors.surface,
  },
  seasonHeaderText: { flexDirection: 'row', gap: 10, alignItems: 'baseline' },
  seasonTitle: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  seasonProgress: { fontSize: 13, color: Colors.textMuted },
  seasonCheck: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seasonCheckComplete: { backgroundColor: Colors.success, borderColor: Colors.success },
  seasonCheckPartial: { borderColor: Colors.accent },
  seasonBarTrack: { height: 3, backgroundColor: Colors.border, overflow: 'hidden' },
  seasonBarFill: { height: '100%' },
  seasonBarComplete: { backgroundColor: Colors.success },
  seasonBarPartial: { backgroundColor: Colors.accent },
  seasonLoading: { marginVertical: 12 },
  episodeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
    backgroundColor: Colors.surface,
  },
  episodeCheckArea: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: Colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  episodeName: { fontSize: 14, flex: 1, color: Colors.textSecondary },
  markLink: { fontSize: 12, color: Colors.accent },
  deleteButton: {
    marginTop: 12,
    marginHorizontal: 16,
    padding: 14,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  deleteButtonDisabled: { opacity: 0.5 },
  deleteButtonText: { color: Colors.error, fontSize: 15, fontWeight: '600' },
});
