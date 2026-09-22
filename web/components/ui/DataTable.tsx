import React from "react";

export interface Column<T> {
  key: string;
  header: string;
  accessor?: (row: T) => React.ReactNode;
  align?: "left" | "center" | "right";
  width?: string;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string | number;
  onRowClick?: (row: T) => void;
  selectedKey?: string | number | null;
  emptyMessage?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  selectedKey,
  emptyMessage = "No records found",
  className = "",
}: DataTableProps<T>) {
  return (
    <div
      className={`relative w-full overflow-x-auto rounded-lg border border-cx-border bg-cx-card ${className}`}
    >
      <table className="w-full text-left text-xs border-collapse">
        <thead className="sticky top-0 z-10 border-b border-cx-border bg-cx-surface text-cx-text-secondary">
          <tr>
            {columns.map((col) => {
              const alignClass =
                col.align === "right"
                  ? "text-right"
                  : col.align === "center"
                    ? "text-center"
                    : "text-left";
              return (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  className={`px-3.5 py-2.5 font-mono text-[11px] font-medium uppercase tracking-wider ${alignClass} ${
                    col.className || ""
                  }`}
                >
                  {col.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-cx-border font-mono text-cx-text">
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-cx-text-muted font-sans text-xs"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, index) => {
              const rowKey = keyExtractor(row, index);
              const isSelected = selectedKey !== undefined && selectedKey === rowKey;
              return (
                <tr
                  key={rowKey}
                  onClick={() => onRowClick && onRowClick(row)}
                  className={`group transition-colors duration-100 ${
                    onRowClick ? "cursor-pointer" : ""
                  } ${
                    isSelected
                      ? "bg-blue-500/10 text-blue-600 dark:text-blue-300 border-l-2 border-l-blue-500"
                      : "hover:bg-cx-hover"
                  }`}
                >
                  {columns.map((col) => {
                    const alignClass =
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                          ? "text-center"
                          : "text-left";
                    const cellContent = col.accessor
                      ? col.accessor(row)
                      : (row as any)[col.key];

                    return (
                      <td
                        key={col.key}
                        className={`px-3.5 py-2.5 text-xs whitespace-nowrap ${alignClass} ${
                          col.className || ""
                        }`}
                      >
                        {cellContent}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
