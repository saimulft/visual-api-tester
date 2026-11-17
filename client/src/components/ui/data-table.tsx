'use client';

import {
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { cn } from './cn';

/**
 * The DataTable shell: TanStack Table for columns and sorting, TanStack Virtual for rows, drawn as the
 * canvas's .tbl. Only the rows in view are in the DOM, so a dataset of 100,000 rows scrolls smoothly.
 * Pass `cascade` to let the first rows cascade in after a run.
 */
const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns });

/** A column for DataTable: `{ accessorKey, header, cell?, meta: { align: 'right' } }`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataColumn<T extends RowData> = ColumnDef<typeof features, T, any>;

export function DataTable<T extends RowData>({
  columns,
  rows,
  height = 480,
  rowHeight = 45,
  cascade,
  selectedId,
  getRowId,
  onRowClick,
  empty,
  label,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  /** The scroll box's height (px or any CSS length). */
  height?: number | string;
  rowHeight?: number;
  cascade?: boolean;
  selectedId?: string | null;
  getRowId?: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  label: string;
}) {
  const table = useTable({ features, data: rows, columns, getRowId });
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRows = table.getRowModel().rows;
  // TanStack Virtual returns functions React Compiler can't memoise, so it skips this component (documented use).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });
  const items = virtual.getVirtualItems();
  const top = items[0]?.start ?? 0;
  const bottom = items.length ? virtual.getTotalSize() - items[items.length - 1].end : 0;
  const colCount = table.getAllLeafColumns().length;

  return (
    <div ref={scrollRef} className="tbl-wrap" style={{ height, overflow: 'auto' }}>
      <table className={cn('tbl', cascade && 'cascade')} aria-label={label} aria-rowcount={tableRows.length + 1}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                const meta = header.column.columnDef.meta as { align?: 'right' } | undefined;
                return (
                  <th
                    key={header.id}
                    className={cn(meta?.align === 'right' && 'r')}
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                  >
                    {canSort ? (
                      <button type="button" className="th-sort" onClick={header.column.getToggleSortingHandler()}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === 'asc' && <ArrowUp className="i i-xs" aria-hidden="true" />}
                        {sorted === 'desc' && <ArrowDown className="i i-xs" aria-hidden="true" />}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {tableRows.length === 0 && (
            <tr>
              <td colSpan={colCount} className="tbl-empty">
                {empty ?? 'No rows yet.'}
              </td>
            </tr>
          )}
          {top > 0 && (
            <tr aria-hidden="true">
              <td colSpan={colCount} style={{ height: top, padding: 0, border: 0 }} />
            </tr>
          )}
          {items.map((item) => {
            const row = tableRows[item.index];
            return (
              <tr
                key={row.id}
                data-index={item.index}
                aria-rowindex={item.index + 2}
                className={cn(selectedId === row.id && 'is-sel', onRowClick && 'is-click')}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getAllCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as { align?: 'right' } | undefined;
                  return (
                    <td key={cell.id} className={cn(meta?.align === 'right' && 'r')}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {bottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={colCount} style={{ height: bottom, padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
