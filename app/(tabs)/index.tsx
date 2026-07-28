import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Link, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { posterUrl } from '@/lib/tmdb';
import { useNextEpisodeStore } from '@/store/nextEpisodeStore';
import { useShowsStore } from '@/store/showsStore';
import type { Show } from '@/types';

// "Watching" and "Up to Date" are both the `watching` ShowStatus under the
// hood, split at render time by whether TMDB still has an unwatched episode
// for the show — there's no separate stored status for "caught up".
type TabKey = 'watching' | 'up_to_date' | 'completed' | 'dropped' | 'plan_to_watch';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'watching', label: 'Watching' },
  { key: 'up_to_date', label: 'Up to Date' },
  { key: 'completed', label: 'Finished' },
  { key: 'dropped', label: 'Dropped' },
  { key: 'plan_to_watch', label: 'Plan to Watch' },
];

const STALE_DAYS = 14;
const NEW_WINDOW_DAYS = 7;

function daysSince(dateString: string) {
  return (Date.now() - new Date(dateString).getTime()) / 86_400_000;
}

function isRecentlyAired(airDate: string | null) {
  if (!airDate) return false;
  const days = daysSince(airDate);
  return days >= 0 && days <= NEW_WINDOW_DAYS;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function formatAirDate(airDate: string | null) {
  if (!airDate) return null;
  return new Date(airDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function ShowRow({ show }: { show: Show }) {
  const entry = useNextEpisodeStore((state) => state.entries[show.id]);
  const load = useNextEpisodeStore((state) => state.load);
  const markWatched = useNextEpisodeStore((state) => state.markWatched);
  const [marking, setMarking] = useState(false);

  useFocusEffect(
    useCallback(() => {
      load(show);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [show.id])
  );

  async function handleCheck() {
    if (marking) return;
    setMarking(true);
    try {
      await markWatched(show);
    } finally {
      setMarking(false);
    }
  }

  const isLoading = !entry || entry.status === 'loading';
  const episode = entry?.status === 'ready' ? entry.episode : null;
  const seriesEnded = entry?.status === 'ready' ? entry.seriesEnded : false;

  return (
    <Link href={{ pathname: '/show/[id]', params: { id: show.id } }} asChild>
      <Pressable style={styles.card}>
        <Image
          source={{ uri: posterUrl(show.poster_path, 'w154') ?? undefined }}
          style={styles.poster}
          contentFit="cover"
        />
        <View style={styles.cardBody}>
          <View style={styles.namePill}>
            <Text style={styles.namePillText} numberOfLines={1}>
              {show.name.toUpperCase()}
            </Text>
            <Ionicons name="chevron-forward" size={12} color={Colors.textPrimary} />
          </View>

          {isLoading ? (
            <ActivityIndicator style={styles.rowLoading} color={Colors.textMuted} />
          ) : episode ? (
            <>
              <Text style={styles.episodeCode}>
                S{pad(episode.seasonNumber)} | E{pad(episode.episodeNumber)}
              </Text>
              <Text style={styles.episodeName} numberOfLines={1}>
                {episode.name}
              </Text>
              <View style={styles.badgeRow}>
                {!episode.hasAired ? (
                  <View style={styles.badgeUpcoming}>
                    <Text style={styles.badgeUpcomingText}>
                      {formatAirDate(episode.airDate) ? `AIRS ${formatAirDate(episode.airDate)}` : 'NOT YET AIRED'}
                    </Text>
                  </View>
                ) : (
                  <>
                    {episode.isPremiere && (
                      <View style={styles.badgePremiere}>
                        <Text style={styles.badgePremiereText}>PREMIERE</Text>
                      </View>
                    )}
                    {isRecentlyAired(episode.airDate) && (
                      <View style={styles.badgeNew}>
                        <Text style={styles.badgeNewText}>NEW</Text>
                      </View>
                    )}
                  </>
                )}
              </View>
            </>
          ) : seriesEnded ? (
            <Text style={styles.finished}>Series finished</Text>
          ) : (
            <Text style={styles.caughtUp}>All caught up</Text>
          )}
        </View>

        {episode && episode.hasAired && (
          <Pressable style={styles.checkButton} onPress={handleCheck} disabled={marking} hitSlop={8}>
            {marking ? (
              <ActivityIndicator color={Colors.accent} />
            ) : (
              <Ionicons name="checkmark" size={20} color={Colors.textPrimary} />
            )}
          </Pressable>
        )}
      </Pressable>
    </Link>
  );
}

export default function MyShowsScreen() {
  const { shows, loading, error, fetchShows } = useShowsStore();
  const entries = useNextEpisodeStore((state) => state.entries);
  const loadNextEpisode = useNextEpisodeStore((state) => state.load);
  const [activeTab, setActiveTab] = useState<TabKey>('watching');
  const [query, setQuery] = useState('');
  const [sortAlpha, setSortAlpha] = useState(false);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [tabMenuAnchor, setTabMenuAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null
  );
  const tabTriggerRef = useRef<View>(null);

  useEffect(() => {
    fetchShows();
  }, []);

  const normalizedQuery = query.trim().toLowerCase();

  const watchingShows = useMemo(() => shows.filter((show) => show.status === 'watching'), [shows]);

  // Watching vs. Up to Date is decided by each show's next-episode data, not
  // by a stored status, so prefetch it for every watching-status show up
  // front regardless of which of the two tabs is active. Re-runs on focus
  // (not just when watchingShows changes) because a show's entry can get
  // invalidated from the detail screen while this list stays mounted in the
  // background — without a focus re-check, a show whose entry was
  // invalidated elsewhere drops out of the list and never gets reloaded
  // since its own row (and that row's focus effect) is no longer mounted.
  useFocusEffect(
    useCallback(() => {
      watchingShows.forEach((show) => loadNextEpisode(show));
    }, [watchingShows, loadNextEpisode])
  );

  const filteredShows = useMemo(() => {
    const matchesQuery = (show: Show) =>
      normalizedQuery === '' || show.name.toLowerCase().includes(normalizedQuery);

    if (activeTab === 'watching' || activeTab === 'up_to_date') {
      return watchingShows.filter((show) => {
        if (!matchesQuery(show)) return false;
        const entry = entries[show.id];
        if (!entry || entry.status !== 'ready') return false;
        const hasNextEpisode = entry.episode !== null;
        return activeTab === 'watching' ? hasNextEpisode : !hasNextEpisode;
      });
    }

    return shows.filter((show) => show.status === activeTab && matchesQuery(show));
  }, [shows, watchingShows, entries, activeTab, normalizedQuery]);

  const sortedShows = useMemo(() => {
    if (!sortAlpha) return filteredShows;
    return [...filteredShows].sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredShows, sortAlpha]);

  const sections = useMemo(() => {
    if (activeTab !== 'watching') {
      return sortedShows.length > 0 ? [{ title: null as string | null, data: sortedShows }] : [];
    }

    // Sort (if any) is applied before grouping, so A–Z ordering is preserved
    // within each section rather than collapsing the sections away.
    const continuing: Show[] = [];
    const stale: Show[] = [];
    const upcoming: Show[] = [];
    for (const show of sortedShows) {
      const entry = entries[show.id];
      const isUpcoming = entry?.status === 'ready' && entry.episode !== null && !entry.episode.hasAired;
      if (isUpcoming) {
        upcoming.push(show);
      } else {
        (daysSince(show.updated_at) > STALE_DAYS ? stale : continuing).push(show);
      }
    }

    const result: { title: string | null; data: Show[] }[] = [];
    if (continuing.length > 0) result.push({ title: 'Continue Watching', data: continuing });
    if (upcoming.length > 0) result.push({ title: 'Upcoming', data: upcoming });
    if (stale.length > 0) result.push({ title: "Haven't Watched For a While", data: stale });
    return result;
  }, [sortedShows, activeTab, entries]);

  const activeLabel = TABS.find((tab) => tab.key === activeTab)?.label ?? '';

  // Watching/Up to Date depend on per-show TMDB lookups that resolve after
  // the shows list itself loads — until every watching-status show's entry
  // is 'ready', treat the tab as still loading so the empty state doesn't
  // flash before those lookups finish.
  const nextEpisodesLoading =
    (activeTab === 'watching' || activeTab === 'up_to_date') &&
    watchingShows.some((show) => entries[show.id]?.status !== 'ready');

  function openTabMenu() {
    tabTriggerRef.current?.measureInWindow((x, y, width, height) => {
      setTabMenuAnchor({ x, y, width, height });
      setTabMenuOpen(true);
    });
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.tabRow}>
        <Pressable ref={tabTriggerRef} style={styles.tabTrigger} onPress={openTabMenu}>
          <Text style={styles.tabTriggerText}>{activeLabel}</Text>
          <Ionicons name="chevron-down" size={16} color={Colors.textPrimary} />
        </Pressable>
      </View>

      <Modal visible={tabMenuOpen} transparent animationType="fade" onRequestClose={() => setTabMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setTabMenuOpen(false)}>
          {tabMenuAnchor && (
            <View
              style={[
                styles.menuCard,
                { top: tabMenuAnchor.y + tabMenuAnchor.height + 6, left: tabMenuAnchor.x, minWidth: tabMenuAnchor.width },
              ]}
            >
              {TABS.map((tab) => (
                <Pressable
                  key={tab.key}
                  style={styles.menuItem}
                  onPress={() => {
                    setActiveTab(tab.key);
                    setTabMenuOpen(false);
                  }}
                >
                  <Text style={[styles.menuItemText, activeTab === tab.key && styles.menuItemTextActive]}>
                    {tab.label}
                  </Text>
                  {activeTab === tab.key && <Ionicons name="checkmark" size={16} color={Colors.accent} />}
                </Pressable>
              ))}
            </View>
          )}
        </Pressable>
      </Modal>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={Colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Filter your shows..."
          placeholderTextColor={Colors.textMuted}
          style={styles.searchInput}
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
          </Pressable>
        )}
        <Pressable
          style={[styles.sortToggle, sortAlpha && styles.sortToggleActive]}
          onPress={() => setSortAlpha((v) => !v)}
          hitSlop={8}
        >
          <Ionicons name="text" size={12} color={sortAlpha ? Colors.accentText : Colors.textMuted} />
          <Text style={[styles.sortToggleText, sortAlpha && styles.sortToggleTextActive]}>A–Z</Text>
        </Pressable>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={fetchShows}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          !loading && !nextEpisodesLoading ? (
            <Text style={styles.empty}>
              {normalizedQuery ? 'No shows match your search.' : 'No shows here yet.'}
            </Text>
          ) : null
        }
        renderSectionHeader={({ section }) =>
          section.title ? (
            <View style={styles.sectionHeaderPill}>
              <Text style={styles.sectionHeaderText}>{section.title.toUpperCase()}</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => <ShowRow show={item} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: Colors.surface,
  },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: 14, padding: 0 },
  sortToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: Colors.surfaceAlt,
  },
  sortToggleActive: { backgroundColor: Colors.accent },
  sortToggleText: { color: Colors.textMuted, fontSize: 11, fontWeight: '700' },
  sortToggleTextActive: { color: Colors.accentText },
  tabTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: Colors.surface,
  },
  tabTriggerText: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },
  menuBackdrop: { flex: 1 },
  menuCard: {
    position: 'absolute',
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  menuItemText: { color: Colors.textSecondary, fontSize: 14 },
  menuItemTextActive: { color: Colors.textPrimary, fontWeight: '700' },
  list: { padding: 16, paddingTop: 4 },
  sectionHeaderPill: {
    alignSelf: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginVertical: 12,
  },
  sectionHeaderText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    minHeight: 138,
  },
  poster: { width: 92, height: 138, backgroundColor: Colors.placeholder },
  cardBody: { flex: 1, padding: 12, justifyContent: 'center', gap: 4 },
  namePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginBottom: 4,
  },
  namePillText: { color: Colors.textPrimary, fontSize: 11, fontWeight: '700', letterSpacing: 0.3, flexShrink: 1 },
  episodeCode: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700' },
  episodeName: { color: Colors.textSecondary, fontSize: 13 },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  badgePremiere: { backgroundColor: Colors.textPrimary, borderRadius: 4, paddingVertical: 2, paddingHorizontal: 6 },
  badgePremiereText: { color: Colors.background, fontSize: 10, fontWeight: '700' },
  badgeNew: { backgroundColor: Colors.accent, borderRadius: 4, paddingVertical: 2, paddingHorizontal: 6 },
  badgeNewText: { color: Colors.accentText, fontSize: 10, fontWeight: '700' },
  badgeUpcoming: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  badgeUpcomingText: { color: Colors.textMuted, fontSize: 10, fontWeight: '700' },
  caughtUp: { color: Colors.textMuted, fontSize: 13, fontStyle: 'italic' },
  finished: { color: Colors.success, fontSize: 13, fontWeight: '600' },
  rowLoading: { alignSelf: 'flex-start', marginTop: 6 },
  checkButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginRight: 12,
  },
  empty: { textAlign: 'center', marginTop: 40, color: Colors.textFaint },
  error: { color: Colors.error, paddingHorizontal: 16, paddingBottom: 8 },
});
