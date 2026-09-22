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
      className={`relative w-full overflow-x-auto rounded-lg border border-[#1f1f23] bg-[#121214] ${className}`}
    >
      <table className="w-full text-left text-xs border-collapse">
        <thead className="sticky top-0 z-10 border-b border-[#1f1f23] bg-[#151518] text-zinc-400">
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
        <tbody className="divide-y divide-[#1f1f23] font-mono text-zinc-300">
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-zinc-500 font-sans text-xs"
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
                      ? "bg-blue-950/30 text-blue-200 border-l-2 border-l-blue-500"
                      : "hover:bg-[#18181b]"
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
