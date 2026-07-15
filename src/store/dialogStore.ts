import { create } from 'zustand';

export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface DialogState {
  visible: boolean;
  title: string;
  message?: string;
  buttons: DialogButton[];
}

interface DialogStore extends DialogState {
  show: (title: string, message: string | undefined, buttons: DialogButton[]) => void;
  hide: () => void;
}

export const useDialogStore = create<DialogStore>((set) => ({
  visible: false,
  title: '',
  message: undefined,
  buttons: [],
  show: (title, message, buttons) => set({ visible: true, title, message, buttons }),
  hide: () => set({ visible: false }),
}));

/** Drop-in replacement for `Alert.alert` that renders `AppDialog` instead of the OS alert. */
export function showDialog(title: string, message?: string, buttons?: DialogButton[]) {
  useDialogStore.getState().show(title, message, buttons ?? [{ text: 'OK' }]);
}
