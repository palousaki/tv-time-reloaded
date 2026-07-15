import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { posterUrl, searchTvShows } from '@/lib/tmdb';
import { consumeShowAdded } from '@/store/searchSignal';
import type { TmdbSearchResult } from '@/types';

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only reset the search when returning here after actually adding a show —
  // going back after a mis-tap should leave the results as they were.
  useFocusEffect(
    useCallback(() => {
      if (consumeShowAdded()) {
        setQuery('');
        setResults([]);
        setError(null);
      }
    }, [])
  );

  function onPressResult(item: TmdbSearchResult) {
    router.push({ pathname: '/add-show/[tmdbId]', params: { tmdbId: String(item.id) } });
  }

  function clearQuery() {
    setQuery('');
    setResults([]);
    setError(null);
  }

  async function runSearch(text: string) {
    setQuery(text);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { results } = await searchTvShows(text.trim());
      setResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={Colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={runSearch}
          placeholder="Search TV shows..."
          placeholderTextColor={Colors.textMuted}
          style={styles.input}
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable onPress={clearQuery} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
          </Pressable>
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={results}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          !loading && query.length >= 2 ? (
            <Text style={styles.empty}>No results.</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onPressResult(item)}>
            <Image
              source={{ uri: posterUrl(item.poster_path, 'w154') ?? undefined }}
              style={styles.poster}
              contentFit="cover"
            />
            <View style={styles.rowText}>
              <Text style={styles.showName}>{item.name}</Text>
              <Text style={styles.year}>{item.first_air_date?.slice(0, 4) ?? 'TBA'}</Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 16,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: Colors.surface,
  },
  input: { flex: 1, color: Colors.textPrimary, fontSize: 16, padding: 0 },
  list: { padding: 16, gap: 12 },
  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 8,
  },
  poster: { width: 46, height: 69, borderRadius: 4, backgroundColor: Colors.placeholder },
  rowText: { flex: 1 },
  showName: { fontSize: 16, fontWeight: '600', color: Colors.textPrimary },
  year: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 40, color: Colors.textFaint },
  error: { color: Colors.error, paddingHorizontal: 16 },
});
