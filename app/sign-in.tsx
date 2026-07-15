import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Colors } from '@/constants/colors';
import { useAuthStore } from '@/store/authStore';

export default function SignInScreen() {
  const signInWithEmail = useAuthStore((state) => state.signInWithEmail);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await signInWithEmail(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send magic link');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>TV Time Reloaded</Text>

      {sent ? (
        <Text style={styles.body}>Check your email for a sign-in link.</Text>
      ) : (
        <>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!loading}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            onPress={handleSend}
            disabled={loading || !email.trim()}
            style={[styles.button, (loading || !email.trim()) && styles.buttonDisabled]}
          >
            {loading ? (
              <ActivityIndicator color={Colors.activeText} />
            ) : (
              <Text style={styles.buttonText}>Send Magic Link</Text>
            )}
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: Colors.background },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 24, textAlign: 'center', color: Colors.textPrimary },
  input: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    color: Colors.textPrimary,
    fontSize: 16,
  },
  button: {
    padding: 14,
    borderRadius: 8,
    backgroundColor: Colors.accent,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: Colors.accentText, fontSize: 16, fontWeight: '600' },
  body: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center' },
  error: { color: Colors.error, fontSize: 13 },
});
