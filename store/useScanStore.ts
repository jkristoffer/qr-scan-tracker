import { create } from 'zustand';
import { Item, Progress } from '@/lib/types';

interface ScanStore {
  items: Item[];
  setItems: (items: Item[]) => void;
  updateItem: (item: Item) => void;
  progress: Progress;
  calculateProgress: () => void;
  lastScan: {
    barcode: string;
    result: 'success' | 'duplicate' | 'not_found';
    message: string;
    timestamp: number;
  } | null;
  setLastScan: (
    scan: { barcode: string; result: 'success' | 'duplicate' | 'not_found'; message: string; timestamp: number } | null
  ) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredItems: Item[];
}

export const useScanStore = create<ScanStore>((set, get) => ({
  items: [],
  setItems: (items) => {
    set({ items });
    get().calculateProgress();
  },
  updateItem: (updatedItem) => {
    set((state) => ({
      items: state.items.map((item) =>
        item.id === updatedItem.id ? updatedItem : item
      ),
    }));
    get().calculateProgress();
  },
  progress: { total: 0, scanned: 0, remaining: 0, percentage: 0 },
  calculateProgress: () => {
    const state = get();
    const total = state.items.length;
    const scanned = state.items.filter((item) => item.scanned).length;
    const remaining = total - scanned;
    const percentage = total > 0 ? (scanned / total) * 100 : 0;

    set({
      progress: { total, scanned, remaining, percentage },
    });
  },
  lastScan: null,
  setLastScan: (scan) => set({ lastScan: scan }),
  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),
  get filteredItems() {
    const state = get();
    if (!state.searchQuery) return state.items;

    const query = state.searchQuery.toLowerCase();
    return state.items.filter(
      (item) =>
        item.barcode.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query)
    );
  },
}));
