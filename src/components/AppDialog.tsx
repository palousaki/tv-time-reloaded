import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors } from '@/constants/colors';
import { useDialogStore, type DialogButton } from '@/store/dialogStore';

function buttonTextStyle(style: DialogButton['style']) {
  if (style === 'destructive') return styles.destructiveText;
  if (style === 'cancel') return styles.cancelText;
  return styles.defaultText;
}

export function AppDialog() {
  const { visible, title, message, buttons } = useDialogStore();
  const hide = useDialogStore((state) => state.hide);
  // More than two buttons don't fit side by side — stack them instead.
  const stacked = buttons.length > 2;

  function handlePress(button: DialogButton) {
    hide();
    button.onPress?.();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={hide}>
      <Pressable style={styles.backdrop} onPress={hide}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.body}>
            <Text style={styles.title}>{title}</Text>
            {message ? <Text style={styles.message}>{message}</Text> : null}
          </View>
          <View style={[styles.buttonRow, stacked && styles.buttonColumn]}>
            {buttons.map((button, index) => (
              <Pressable
                key={button.text}
                style={[
                  styles.button,
                  // `flex: 1` in a column with auto height collapses each
                  // button to its padding and hides the label — size to content.
                  stacked && styles.buttonStacked,
                  index > 0 && (stacked ? styles.buttonDividerTop : styles.buttonDivider),
                  buttons.length === 1 && styles.buttonSingle,
                ]}
                onPress={() => handlePress(button)}
              >
                <Text style={buttonTextStyle(button.style)}>{button.text}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  body: { padding: 20, gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  message: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  buttonRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonColumn: { flexDirection: 'column' },
  buttonStacked: { flex: 0 },
  buttonSingle: { flex: 1 },
  buttonDividerTop: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  buttonDivider: {
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
  },
  defaultText: { fontSize: 15, fontWeight: '600', color: Colors.accent },
  cancelText: { fontSize: 15, fontWeight: '500', color: Colors.textSecondary },
  destructiveText: { fontSize: 15, fontWeight: '600', color: Colors.error },
});
