import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { computeTotalWatchMinutes, formatWatchTime } from '@/lib/watchTime';
import { useAuthStore } from '@/store/authStore';
import { showDialog } from '@/store/dialogStore';
import { useShowsStore } from '@/store/showsStore';
import type { ShowStatus } from '@/types';

const STATUS_TILES: { key: ShowStatus; label: string }[] = [
  { key: 'watching', label: 'Watching' },
  { key: 'completed', label: 'Finished' },
  { key: 'plan_to_watch', label: 'Plan to Watch' },
  { key: 'dropped', label: 'Dropped' },
];

export default function SettingsScreen() {
  const email = useAuthStore((state) => state.session?.user.email);
  const displayName = useAuthStore((state) => state.session?.user.user_metadata?.display_name as string | undefined);
  const signOut = useAuthStore((state) => state.signOut);
  const shows = useShowsStore((state) => state.shows);
  const fetchShows = useShowsStore((state) => state.fetchShows);

  const [episodesWatched, setEpisodesWatched] = useState<number | null>(null);
  const [episodesWatchedError, setEpisodesWatchedError] = useState(false);
  const [watchMinutes, setWatchMinutes] = useState<number | null>(null);
  const [watchTimeError, setWatchTimeError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEpisodesWatched = useCallback(async () => {
    setEpisodesWatchedError(false);
    const { count, error } = await supabase
      .from('episode_watches')
      .select('*', { count: 'exact', head: true });
    if (error) {
      setEpisodesWatchedError(true);
      return;
    }
    setEpisodesWatched(count ?? 0);
  }, []);

  const fetchWatchTime = useCallback(async (showsList: typeof shows) => {
    if (showsList.length === 0) return;
    setWatchTimeError(false);
    try {
      const minutes = await computeTotalWatchMinutes(showsList);
      setWatchMinutes(minutes);
    } catch {
      setWatchTimeError(true);
    }
  }, []);

  useEffect(() => {
    if (shows.length === 0) fetchShows();
  }, []);

  useEffect(() => {
    fetchEpisodesWatched();
  }, [fetchEpisodesWatched]);

  useEffect(() => {
    fetchWatchTime(shows);
  }, [shows, fetchWatchTime]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchShows();
    await Promise.all([fetchEpisodesWatched(), fetchWatchTime(useShowsStore.getState().shows)]);
    setRefreshing(false);
  }

  function handleSignOut() {
    showDialog('Are you sure you want to sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  }

  const statusCounts = STATUS_TILES.map((tile) => ({
    ...tile,
    count: shows.filter((s) => s.status === tile.key).length,
  }));

  const watchTime = watchMinutes != null ? formatWatchTime(watchMinutes) : null;
  const name = displayName || email || '?';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.accent} />
        }
      >
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileName} numberOfLines={1}>
              {name}
            </Text>
            {displayName && (
              <Text style={styles.profileEmail} numberOfLines={1}>
                {email}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="stats-chart" size={16} color={Colors.accent} />
            <Text style={styles.sectionTitle}>Stats</Text>
          </View>
          <View style={styles.tvTimeCard}>
            {watchTimeError ? (
              <Pressable style={styles.retryRow} onPress={() => fetchWatchTime(shows)}>
                <Ionicons name="refresh" size={14} color={Colors.textMuted} />
                <Text style={styles.retryText}>Couldn't load — tap to retry</Text>
              </Pressable>
            ) : (
              <>
                <Text style={styles.tvTimeCardLabel}>TV TIME</Text>
                <View style={styles.tvTimeRow}>
                  <View style={styles.tvTimeUnit}>
                    <Text style={styles.tvTimeValue}>{watchTime?.months ?? '—'}</Text>
                    <Text style={styles.tvTimeUnitLabel}>MONTHS</Text>
                  </View>
                  <View style={styles.tvTimeUnit}>
                    <Text style={styles.tvTimeValue}>{watchTime?.days ?? '—'}</Text>
                    <Text style={styles.tvTimeUnitLabel}>DAYS</Text>
                  </View>
                  <View style={styles.tvTimeUnit}>
                    <Text style={styles.tvTimeValue}>{watchTime?.hours ?? '—'}</Text>
                    <Text style={styles.tvTimeUnitLabel}>HOURS</Text>
                  </View>
                </View>
              </>
            )}
          </View>
          <View style={styles.statsRow}>
            <View style={styles.statTile}>
              {episodesWatchedError ? (
                <Pressable style={styles.retryRow} onPress={() => fetchEpisodesWatched()}>
                  <Ionicons name="refresh" size={14} color={Colors.textMuted} />
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
              ) : (
                <>
                  <Text style={styles.statValue}>{episodesWatched ?? '—'}</Text>
                  <Text style={styles.statLabel}>Episodes watched</Text>
                </>
              )}
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statValue}>{shows.length}</Text>
              <Text style={styles.statLabel}>Shows tracked</Text>
            </View>
          </View>
          <View style={styles.statusGrid}>
            {statusCounts.map((tile) => (
              <View key={tile.key} style={styles.statusTile}>
                <Text style={styles.statusCount}>{tile.count}</Text>
                <Text style={styles.statusLabel}>{tile.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.attribution}>
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </Text>
        </View>

        <View style={styles.divider} />

        <Pressable style={styles.signOutButton} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={16} color={Colors.error} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>

        <Text style={styles.version}>Version {Constants.expoConfig?.version ?? '—'}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  container: { padding: 16, gap: 24, flexGrow: 1 },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Colors.accentText, fontSize: 22, fontWeight: '700' },
  profileText: { flex: 1, gap: 2 },
  profileName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  profileEmail: { fontSize: 12, color: Colors.textMuted },

  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 14,
    borderRadius: 12,
    backgroundColor: Colors.surface,
  },
  signOutText: { color: Colors.error, fontSize: 14, fontWeight: '600' },

  divider: { height: 1, backgroundColor: Colors.border },
  version: { fontSize: 12, color: Colors.textFaint, textAlign: 'center' },

  section: { gap: 10 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  attribution: { fontSize: 12, color: Colors.textFaint },

  tvTimeCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 10,
  },
  tvTimeCardLabel: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.5 },
  tvTimeRow: { flexDirection: 'row' },
  tvTimeUnit: { flex: 1, alignItems: 'center', gap: 2 },
  tvTimeValue: { fontSize: 26, fontWeight: '700', color: Colors.accent },
  tvTimeUnitLabel: { fontSize: 11, color: Colors.textMuted, letterSpacing: 0.5 },

  statsRow: { flexDirection: 'row', gap: 10 },
  statTile: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 2,
  },
  statValue: { fontSize: 24, fontWeight: '700', color: Colors.accent },
  statLabel: { fontSize: 12, color: Colors.textMuted },
  retryRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  retryText: { fontSize: 12, color: Colors.textMuted },

  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statusTile: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 2,
  },
  statusCount: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  statusLabel: { fontSize: 12, color: Colors.textMuted },
});
