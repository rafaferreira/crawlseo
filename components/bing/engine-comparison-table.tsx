"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { EngineRow } from "@/lib/bing-metrics";
import {
  MetricTable,
  NumCell,
  PositionBadge,
  SearchField,
  filterInputClass,
  sortLabel,
  sortRows,
  useTableSort,
  type MetricHeader,
} from "@/components/ui/data-table";

type Presence = "all" | "both" | "bing" | "google";

const PRESENCE_OPTIONS: { value: Presence; label: string }[] = [
  { value: "all", label: "All queries" },
  { value: "both", label: "Both engines" },
  { value: "bing", label: "Only Bing sees it" },
  { value: "google", label: "Only Google sees it" },
];

const HEADERS: MetricHeader[] = [
  { label: "Query", sortKey: "query", defaultDir: "asc" },
  { label: "Google", align: "right", sortKey: "googlePosition", defaultDir: "asc" },
  { label: "Bing", align: "right", sortKey: "bingPosition", defaultDir: "asc" },
  { label: "Gap", align: "right", sortKey: "gap" },
  { label: "Google impr.", align: "right", sortKey: "googleImpressions" },
  { label: "Bing impr.", align: "right", sortKey: "bingImpressions" },
];

const SORT_OPTIONS = HEADERS.filter((header) => header.sortKey).map((header) => ({
  value: header.sortKey as string,
  label: header.label,
}));

export function EngineComparisonTable({ rows }: { rows: EngineRow[] }) {
  const [search, setSearch] = useState("");
  const [presence, setPresence] = useState<Presence>("all");
  const [minGap, setMinGap] = useState("");
  const { sort, setSort, toggle } = useTableSort({
    key: "googleImpressions",
    dir: "desc",
  });

  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const minGapNum = minGap.trim() === "" ? null : Number(minGap);

  const filtered = useMemo(() => {
    const matching = rows.filter((row) => {
      if (deferredSearch && !row.query.toLowerCase().includes(deferredSearch)) {
        return false;
      }
      if (presence !== "all" && row.presence !== presence) return false;
      if (minGapNum != null) {
        if (row.gap == null || Math.abs(row.gap) < minGapNum) return false;
      }
      return true;
    });

    return sortRows(matching, sort);
  }, [rows, deferredSearch, presence, minGapNum, sort]);

  const hasActiveFilters =
    search.trim() !== "" ||
    presence !== "all" ||
    minGap.trim() !== "" ||
    sort.key !== "googleImpressions" ||
    sort.dir !== "desc";

  function clearFilters() {
    setSearch("");
    setPresence("all");
    setMinGap("");
    setSort({ key: "googleImpressions", dir: "desc" });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Filter by query..."
        />

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Seen by
          </span>
          <select
            value={presence}
            onChange={(e) => setPresence(e.target.value as Presence)}
            className={`${filterInputClass} pr-8`}
          >
            {PRESENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Min gap
          </span>
          <input
            type="number"
            min={0}
            value={minGap}
            onChange={(e) => setMinGap(e.target.value)}
            placeholder="0"
            className={`${filterInputClass} w-24`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Sort by
          </span>
          <select
            value={sort.key}
            onChange={(e) => {
              const key = e.target.value;
              setSort({
                key,
                dir: HEADERS.find((h) => h.sortKey === key)?.defaultDir ?? "desc",
              });
            }}
            className={`${filterInputClass} pr-8`}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="h-9 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="panel px-4 py-10 text-center">
          <p className="font-medium text-foreground">No queries match</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Loosen the engine or gap filter.
          </p>
        </div>
      ) : (
        <MetricTable
          sort={sort}
          onSort={toggle}
          headers={HEADERS}
          footer={`Showing ${filtered.length} of ${rows.length} queries · sorted by ${sortLabel(HEADERS, sort)}`}
        >
          {filtered.map((row) => (
            <tr
              key={`${row.presence}-${row.query}`}
              className="transition-colors hover:bg-muted/25"
            >
              <td className="max-w-md px-4 py-3">
                <span className="font-medium text-foreground">{row.query}</span>
              </td>
              <td className="px-4 py-3 text-right">
                {row.googlePosition != null ? (
                  <PositionBadge position={row.googlePosition} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {row.bingPosition != null ? (
                  <PositionBadge position={row.bingPosition} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right font-data text-sm">
                {row.gap == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span
                    className={
                      row.gap > 0
                        ? "text-signal"
                        : row.gap < 0
                          ? "text-danger"
                          : "text-muted-foreground"
                    }
                  >
                    {row.gap > 0 ? "+" : ""}
                    {row.gap.toFixed(1)}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <NumCell value={row.googleImpressions} />
              </td>
              <td className="px-4 py-3 text-right">
                <NumCell value={row.bingImpressions} />
              </td>
            </tr>
          ))}
        </MetricTable>
      )}
    </div>
  );
}
