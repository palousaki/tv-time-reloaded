import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Link, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { posterUrl } from '@/lib/tmdb';
import { showDialog } from '@/store/dialogStore';
import { useNextEpisodeStore, type MarkWatchedUndo, type ShowSummary } from '@/store/nextEpisodeStore';
import { useShowsStore } from '@/store/showsStore';
import type { Show, ShowStatus } from '@/types';

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

const STATUS_LABELS: Record<ShowStatus, string> = {
  watching: 'Watching',
  completed: 'Finished',
  dropped: 'Dropped',
  plan_to_watch: 'Plan to Watch',
};

const UNDO_TIMEOUT_MS = 5000;
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

function timeAgo(dateString: string) {
  const days = Math.floor(daysSince(dateString));
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

function formatHours(minutes: number) {
  const hours = Math.round(minutes / 60);
  return hours < 1 ? `~${minutes}m` : `~${hours}h`;
}


const TMDB_STATUS_TEXT: Partial<Record<ShowSummary['tmdbStatus'], string>> = {
  'Returning Series': 'Returning series · awaiting new episodes',
  'In Production': 'In production',
  Planned: 'New season planned',
  Pilot: 'Pilot',
};

// Up to Date: where you left off, and whether more is coming.
function UpToDateInfo({ summary, lastWatchedAt }: { summary: ShowSummary; lastWatchedAt: string | null }) {
  const statusText = TMDB_STATUS_TEXT[summary.tmdbStatus];
  return (
    <>
      {summary.lastWatched && (
        <Text style={styles.episodeCode}>
          S{pad(summary.lastWatched.seasonNumber)} | E{pad(summary.lastWatched.episodeNumber)}
        </Text>
      )}
      {lastWatchedAt && <Text style={styles.episodeName}>Last watched {timeAgo(lastWatchedAt)}</Text>}
      {statusText && <Text style={styles.remainingText}>{statusText}</Text>}
    </>
  );
}

// Finished: a short recap of the series.
function FinishedInfo({ summary }: { summary: ShowSummary }) {
  const { seasonCount, episodeCount, totalMinutes, firstAirYear, lastAirYear } = summary;
  const years =
    firstAirYear && lastAirYear && lastAirYear !== firstAirYear
      ? `${firstAirYear}–${lastAirYear}`
      : firstAirYear
        ? String(firstAirYear)
        : null;
  return (
    <>
      <Text style={styles.statsText}>
        {seasonCount} season{seasonCount === 1 ? '' : 's'} · {episodeCount} episode{episodeCount === 1 ? '' : 's'} ·{' '}
        {formatHours(totalMinutes)}
      </Text>
      {years && <Text style={styles.episodeName}>Aired {years}</Text>}    </>
  );
}

// TMDB air dates are plain 'YYYY-MM-DD' — compare as local calendar days so
// "tomorrow" means tomorrow where the user is, not in UTC.
function calendarDaysUntil(airDate: string) {
  const [y, m, d] = airDate.split('-').map(Number);
  const air = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((air - today) / 86_400_000);
}

function upcomingLabel(airDate: string | null) {
  if (!airDate) return 'NOT YET AIRED';
  const days = calendarDaysUntil(airDate);
  if (days <= 0) return 'AIRS TODAY';
  if (days === 1) return 'AIRS TOMORROW';
  if (days <= 30) return `AIRS IN ${days} DAYS`;
  return `AIRS ${formatAirDate(airDate)}`;
}

function ShowRow({ show, onMarked }: { show: Show; onMarked: (show: Show, undo: MarkWatchedUndo) => void }) {
  const entry = useNextEpisodeStore((state) => state.entries[show.id]);
  const load = useNextEpisodeStore((state) => state.load);
  const markWatched = useNextEpisodeStore((state) => state.markWatched);
  const changeStatus = useNextEpisodeStore((state) => state.changeStatus);
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
      const undo = await markWatched(show);
      if (undo) onMarked(show, undo);
    } catch (err) {
      showDialog('Failed to mark episode', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setMarking(false);
    }
  }

  function confirmStatusChange(status: ShowStatus) {
    // Finished also bulk-marks every unwatched episode, so spell that out.
    const message =
      status === 'completed'
        ? 'All unwatched episodes will be marked as watched.'
        : undefined;
    showDialog(`Move ${show.name} to ${STATUS_LABELS[status]}?`, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Move',
        onPress: () => {
          changeStatus(show, status).catch((err) =>
            showDialog('Failed to update status', err instanceof Error ? err.message : 'Unknown error')
          );
        },
      },
    ]);
  }

  function handleLongPress() {
    const options = (Object.keys(STATUS_LABELS) as ShowStatus[]).filter((status) => status !== show.status);
    showDialog(show.name, 'Move to…', [
      ...options.map((status) => ({
        text: STATUS_LABELS[status],
        onPress: () => confirmStatusChange(status),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  const isLoading = !entry || entry.status === 'loading';
  const episode = entry?.status === 'ready' ? entry.episode : null;
  const ready = entry?.status === 'ready' ? entry : null;

  return (
    <Link href={{ pathname: '/show/[id]', params: { id: show.id } }} asChild>
      <Pressable style={styles.card} onLongPress={handleLongPress}>
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
              {episode.hasAired && episode.episodesRemaining > 0 && (
                <Text style={styles.remainingText}>
                  {episode.episodesRemaining} episode{episode.episodesRemaining === 1 ? '' : 's'} to catch up
                </Text>
              )}
              <View style={styles.badgeRow}>
                {!episode.hasAired ? (
                  <View style={styles.badgeUpcoming}>
                    <Text style={styles.badgeUpcomingText}>{upcomingLabel(episode.airDate)}</Text>
                  </View>
                ) : (
                  <>
                    {episode.isPremiere && (
                      <View style={styles.badgePremiere}>
                        <Text style={styles.badgePremiereText}>PREMIERE</Text>
                      </View>
                    )}
                    {episode.isFinale && (
                      <View style={styles.badgePremiere}>
                        <Text style={styles.badgePremiereText}>SEASON FINALE</Text>
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
          ) : ready && show.status === 'completed' ? (
            <FinishedInfo summary={ready.summary} />
          ) : ready ? (
            <UpToDateInfo summary={ready.summary} lastWatchedAt={ready.lastWatchedAt} />
          ) : null}
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
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const [tabMenuAnchor, setTabMenuAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null
  );
  const tabTriggerRef = useRef<View>(null);
  const undoMarkWatched = useNextEpisodeStore((state) => state.undoMarkWatched);
  const [pendingUndo, setPendingUndo] = useState<{ show: Show; undo: MarkWatchedUndo } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchShows();
  }, []);

  useEffect(
    () => () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    },
    []
  );

  const handleMarked = useCallback((show: Show, undo: MarkWatchedUndo) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setPendingUndo({ show, undo });
    undoTimerRef.current = setTimeout(() => setPendingUndo(null), UNDO_TIMEOUT_MS);
  }, []);

  async function handleUndo() {
    if (!pendingUndo) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const { show, undo } = pendingUndo;
    setPendingUndo(null);
    try {
      await undoMarkWatched(show, undo);
    } catch (err) {
      showDialog('Failed to undo', err instanceof Error ? err.message : 'Unknown error');
    }
  }

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
      return sortedShows.length > 0
        ? [{ title: null as string | null, data: sortedShows }]
        : [];
    }

    // Sort (if any) is applied before grouping, so A–Z ordering is preserved
    // within each section rather than collapsing the sections away.
    const continuing: Show[] = [];
    const stale: Show[] = [];
    const upcoming: Show[] = [];
    for (const show of sortedShows) {
      const entry = entries[show.id];
      const isUpcoming = entry?.status === 'ready' && entry.episode !== null && !entry.episode.hasAired;
      // A season/series premiere that just aired means fresh content is
      // waiting regardless of how long ago `updated_at` was touched — that's
      // "continue watching," not "you've neglected this."
      const isFreshPremiere =
        entry?.status === 'ready' &&
        entry.episode !== null &&
        entry.episode.hasAired &&
        entry.episode.isPremiere &&
        isRecentlyAired(entry.episode.airDate);
      if (isUpcoming) {
        upcoming.push(show);
      } else if (isFreshPremiere) {
        continuing.push(show);
      } else {
        // Last real watch, not shows.updated_at (which any edit bumps). A
        // show with no watches yet counts from when it was added.
        const lastActivity = (entry?.status === 'ready' && entry.lastWatchedAt) || show.created_at;
        (daysSince(lastActivity) > STALE_DAYS ? stale : continuing).push(show);
      }
    }

    // Custom ordering only when A–Z isn't on, so the toggle still means A–Z.
    if (!sortAlpha) {
      const nextEp = (show: Show) => {
        const entry = entries[show.id];
        return entry?.status === 'ready' ? entry.episode : null;
      };
      // Fresh stuff (NEW or PREMIERE badge) floats to the top; Array.sort is
      // stable, so the existing order is kept within each group.
      const freshRank = (show: Show) => {
        const ep = nextEp(show);
        return ep && (ep.isPremiere || isRecentlyAired(ep.airDate)) ? 0 : 1;
      };
      continuing.sort((a, b) => freshRank(a) - freshRank(b));
      // Soonest air date first; undated (unscheduled) episodes last.
      const airTime = (show: Show) => {
        const airDate = nextEp(show)?.airDate;
        return airDate ? new Date(airDate).getTime() : Number.POSITIVE_INFINITY;
      };
      upcoming.sort((a, b) => airTime(a) - airTime(b));
    }

    // Collapsed sections keep their header but render no rows.
    const result: { title: string | null; data: Show[] }[] = [];
    const push = (title: string, data: Show[]) => {
      if (data.length === 0) return;
      result.push({ title, data: collapsedSections.has(title) ? [] : data });
    };
    push('Continue Watching', continuing);
    push("Haven't Watched For a While", stale);
    push('Upcoming', upcoming);
    return result;
  }, [sortedShows, activeTab, entries, collapsedSections, sortAlpha]);

  function toggleSection(title: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

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
        renderSectionHeader={({ section }) => {
          const title = section.title;
          if (!title) return null;
          const collapsed = collapsedSections.has(title);
          return (
            <Pressable style={styles.sectionHeaderPill} onPress={() => toggleSection(title)} hitSlop={8}>
              <Text style={styles.sectionHeaderText}>{title.toUpperCase()}</Text>
              <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={14} color={Colors.textSecondary} />
            </Pressable>
          );
        }}
        renderItem={({ item }) => <ShowRow show={item} onMarked={handleMarked} />}
      />

      {pendingUndo && (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText} numberOfLines={1}>
            Marked {pendingUndo.show.name} S{pad(pendingUndo.undo.seasonNumber)}E{pad(pendingUndo.undo.episodeNumber)}
          </Text>
          <Pressable onPress={handleUndo} hitSlop={8}>
            <Text style={styles.snackbarAction}>UNDO</Text>
          </Pressable>
        </View>
      )}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  remainingText: { color: Colors.textMuted, fontSize: 11, marginTop: 2 },
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
  statsText: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
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
  snackbar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  snackbarText: { flex: 1, color: Colors.textPrimary, fontSize: 13 },
  snackbarAction: { color: Colors.accent, fontSize: 13, fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 40, color: Colors.textFaint },
  error: { color: Colors.error, paddingHorizontal: 16, paddingBottom: 8 },
});
