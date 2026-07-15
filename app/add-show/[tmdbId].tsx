import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { getTvShowDetails, posterUrl } from '@/lib/tmdb';
import { markShowAdded } from '@/store/searchSignal';
import { showDialog } from '@/store/dialogStore';
import { useShowsStore } from '@/store/showsStore';
import type { ShowStatus, TmdbShowDetails } from '@/types';

export default function AddShowScreen() {
  const { tmdbId } = useLocalSearchParams<{ tmdbId: string }>();
  const numericTmdbId = Number(tmdbId);

  const addShow = useShowsStore((state) => state.addShow);
  const shows = useShowsStore((state) => state.shows);
  const existingShow = shows.find((s) => s.tmdb_id === numericTmdbId);

  const [details, setDetails] = useState<TmdbShowDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingStatus, setAddingStatus] = useState<ShowStatus | null>(null);

  useEffect(() => {
    if (!tmdbId) return;
    setLoading(true);
    setError(null);
    getTvShowDetails(numericTmdbId)
      .then(setDetails)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load show'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId]);

  async function handleAdd(status: ShowStatus) {
    setAddingStatus(status);
    try {
      const show = await addShow(numericTmdbId, status);
      markShowAdded();
      router.replace({ pathname: '/show/[id]', params: { id: show.id } });
    } catch (err) {
      showDialog('Could not add show', err instanceof Error ? err.message : 'Unknown error');
      setAddingStatus(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  if (error || !details) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Show not found'}</Text>
      </View>
    );
  }

  const regularSeasons = details.seasons.filter((s) => s.season_number > 0);
  const year = details.first_air_date?.slice(0, 4);
  const metaParts = [
    year,
    `${regularSeasons.length} season${regularSeasons.length === 1 ? '' : 's'}`,
    details.genres[0]?.name,
  ].filter(Boolean);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Image
          source={{ uri: posterUrl(details.poster_path, 'w500') ?? undefined }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
        <View style={styles.heroScrim} />
        <View style={styles.heroContent}>
          <Text style={styles.name}>{details.name}</Text>
          <Text style={styles.meta}>{metaParts.join(' · ')}</Text>
          {details.vote_average > 0 && (
            <Text style={styles.rating}>★ {details.vote_average.toFixed(1)}/10</Text>
          )}
        </View>
      </View>

      {details.overview ? (
        <Text style={styles.overview}>{details.overview}</Text>
      ) : (
        <Text style={styles.overviewEmpty}>No description available.</Text>
      )}

      <View style={styles.actions}>
        {existingShow ? (
          <>
            <Text style={styles.alreadyText}>Already in your list</Text>
            <Pressable
              style={styles.primaryButton}
              onPress={() => router.replace({ pathname: '/show/[id]', params: { id: existingShow.id } })}
            >
              <Text style={styles.primaryButtonText}>View Show</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              style={styles.primaryButton}
              onPress={() => handleAdd('watching')}
              disabled={addingStatus != null}
            >
              {addingStatus === 'watching' ? (
                <ActivityIndicator color={Colors.accentText} />
              ) : (
                <Text style={styles.primaryButtonText}>Start Watching</Text>
              )}
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => handleAdd('plan_to_watch')}
              disabled={addingStatus != null}
            >
              {addingStatus === 'plan_to_watch' ? (
                <ActivityIndicator color={Colors.textPrimary} />
              ) : (
                <Text style={styles.secondaryButtonText}>Plan to Watch</Text>
              )}
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: Colors.background },
  container: { paddingBottom: 32, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: Colors.background },
  error: { color: Colors.error, fontSize: 15 },

  hero: { height: 320, backgroundColor: Colors.placeholder, justifyContent: 'flex-end' },
  heroScrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  heroContent: { padding: 16, gap: 4 },
  name: { fontSize: 24, fontWeight: '700', color: Colors.textPrimary },
  meta: { fontSize: 14, color: Colors.textSecondary },
  rating: { fontSize: 13, color: Colors.accent, fontWeight: '600', marginTop: 2 },

  overview: { fontSize: 14, lineHeight: 20, color: Colors.textSecondary, paddingHorizontal: 16 },
  overviewEmpty: { fontSize: 14, color: Colors.textFaint, paddingHorizontal: 16, fontStyle: 'italic' },

  actions: { paddingHorizontal: 16, gap: 10, marginTop: 8 },
  alreadyText: { color: Colors.textMuted, fontSize: 13, textAlign: 'center' },
  primaryButton: {
    padding: 14,
    borderRadius: 8,
    backgroundColor: Colors.accent,
    alignItems: 'center',
  },
  primaryButtonText: { color: Colors.accentText, fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    padding: 14,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  secondaryButtonText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
});
