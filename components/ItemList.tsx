'use client';

import { useScanStore } from '@/store/useScanStore';

export function ItemList() {
  const { filteredItems, searchQuery, setSearchQuery, progress } =
    useScanStore();

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by barcode or name..."
          className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-700 dark:text-white"
        />
        <p className="text-xs text-slate-500 mt-2">
          Showing {filteredItems.length} of {progress.total} items
        </p>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            No items found
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-900/50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Barcode
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {filteredItems.map((item) => (
                <tr
                  key={item.id}
                  className={item.scanned ? 'bg-green-50 dark:bg-green-900/10' : ''}
                >
                  <td className="px-4 py-3 text-sm font-mono text-slate-700 dark:text-slate-300">
                    {item.barcode}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                    {item.name}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {item.scanned ? (
                      <span className="inline-flex items-center text-green-600">
                        ✓ {item.scanned_by || 'Unknown'}
                      </span>
                    ) : (
                      <span className="text-slate-500">Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
