import { create } from 'zustand';
import { Item, Progress } from '@/lib/types';

function computeProgress(items: Item[]): Progress {
  const total = items.length;
  const scanned = items.filter(i => i.scanned).length;
  return { total, scanned, remaining: total - scanned, percentage: total > 0 ? (scanned / total) * 100 : 0 };
}

function applyFilter(items: Item[], query: string): Item[] {
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter(i =>
    i.barcode.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)
  );
}

interface LastScan {
  barcode: string;
  result: 'success' | 'duplicate' | 'not_found';
  message: string;
  timestamp: number;
}

interface ScanStore {
  items: Item[];
  filteredItems: Item[];
  setItems: (items: Item[]) => void;
  updateItem: (item: Item) => void;
  progress: Progress;
  lastScan: LastScan | null;
  setLastScan: (scan: LastScan | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const useScanStore = create<ScanStore>((set, get) => ({
  items: [],
  filteredItems: [],
  progress: { total: 0, scanned: 0, remaining: 0, percentage: 0 },
  lastScan: null,
  searchQuery: '',

  setItems: (items) => {
    set({
      items,
      filteredItems: applyFilter(items, get().searchQuery),
      progress: computeProgress(items),
    });
  },

  updateItem: (updatedItem) => {
    set((state) => {
      const existingIndex = state.items.findIndex(item => item.id === updatedItem.id);
      const items = updatedItem.removed
        ? state.items.filter(item => item.id !== updatedItem.id)
        : existingIndex >= 0
          ? state.items.map(item => item.id === updatedItem.id ? updatedItem : item)
          : [...state.items, updatedItem];
      return {
        items,
        filteredItems: applyFilter(items, state.searchQuery),
        progress: computeProgress(items),
      };
    });
  },

  setLastScan: (scan) => set({ lastScan: scan }),

  setSearchQuery: (query) => {
    set((state) => ({
      searchQuery: query,
      filteredItems: applyFilter(state.items, query),
    }));
  },
}));
