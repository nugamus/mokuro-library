import { writable } from 'svelte/store';

interface RenameState {
  isOpen: boolean;
  currentTitle: string;
  // The callback now takes the new title (or null) and returns a Promise (for loading state)
  onSave: (newTitle: string | null) => Promise<void>;
}

const initialState: RenameState = {
  isOpen: false,
  currentTitle: '',
  onSave: async () => { }
};

function createRenameStore() {
  const { subscribe, set, update } = writable<RenameState>(initialState);

  return {
    subscribe,
    /**
     * Opens the rename modal.
     */
    open: (currentTitle: string, onSave: (newTitle: string | null) => Promise<void>) => {
      set({
        isOpen: true,
        currentTitle,
        onSave
      });
    },
    close: () => {
      update((s) => ({ ...s, isOpen: false }));
    }
  };
}

export const renameStore = createRenameStore();
