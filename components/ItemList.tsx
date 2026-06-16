'use client';

import { useScanStore } from '@/store/useScanStore';

export function ItemList() {
  const { filteredItems, searchQuery, setSearchQuery, progress } = useScanStore();

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      {/* Search */}
      <div className="px-4 py-3 border-b border-neutral-100">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search barcode or name…"
          className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900"
        />
        {searchQuery && (
          <p className="text-xs text-neutral-400 mt-1.5">
            {filteredItems.length} of {progress.total} items
          </p>
        )}
      </div>

      {/* List */}
      <div className="max-h-[420px] overflow-y-auto divide-y divide-neutral-100">
        {filteredItems.length === 0 ? (
          <div className="py-10 text-center text-sm text-neutral-400">
            {searchQuery ? 'No items match your search' : 'No items'}
          </div>
        ) : (
          filteredItems.map(item => (
            <div
              key={item.id}
              className="flex items-center justify-between px-4 py-3 gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-mono text-neutral-600 truncate">{item.barcode}</p>
                <p className="text-sm text-neutral-900 truncate">{item.name}</p>
              </div>
              <div className="flex-shrink-0 text-right">
                {item.scanned ? (
                  <div>
                    <p className="text-xs font-medium text-neutral-900">✓ Scanned</p>
                    <p className="text-xs text-neutral-400 mt-0.5">{item.scanned_by}</p>
                  </div>
                ) : (
                  <span className="text-xs text-neutral-300">Pending</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
