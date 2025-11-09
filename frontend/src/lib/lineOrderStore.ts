import { writable } from 'svelte/store';
import type { MokuroBlock } from './types';

type LineOrderState = {
  isOpen: boolean;
  block: MokuroBlock | null;
  onSave: () => void;
};

// Default empty state
const defaultState: LineOrderState = {
  isOpen: false,
  block: null,
  onSave: () => { } // No-op
};

function createLineOrderStore() {
  const { subscribe, set } = writable<LineOrderState>(defaultState);

  return {
    subscribe,
    /**
     * Opens the line order modal for a specific block.
     */
    open: (block: MokuroBlock, onSave: () => void) => {
      set({
        isOpen: true,
        block,
        onSave
      });
    },
    /**
     * Closes the modal and resets to default state.
     */
    close: () => {
      set(defaultState);
    }
  };
}

export const lineOrderStore = createLineOrderStore();
