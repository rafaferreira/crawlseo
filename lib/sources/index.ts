import { googleSource } from "./google";
import { bingSource } from "./bing";
import type { DataSource, SourceId } from "./types";

export type { DataSource, SourceId, SourceRow, SourceDailyRow } from "./types";

/** Every source the app knows how to read. Order is display order. */
export const SOURCES: DataSource[] = [googleSource, bingSource];

export function sourceById(id: SourceId): DataSource | undefined {
  return SOURCES.find((source) => source.id === id);
}

/** The sources actually configured for a site. */
export async function enabledSources(siteId: string): Promise<DataSource[]> {
  const flags = await Promise.all(
    SOURCES.map((source) => source.isEnabled(siteId))
  );
  return SOURCES.filter((_, index) => flags[index]);
}

/**
 * The sources a screen should read, honouring an optional filter.
 *
 * An unknown or unconfigured filter value falls back to everything enabled,
 * so a stale bookmark shows data rather than an empty screen.
 */
export async function resolveSources(
  siteId: string,
  filter?: SourceId | SourceId[] | null
): Promise<DataSource[]> {
  const enabled = await enabledSources(siteId);
  if (!filter || filter === "all") return enabled;

  const wanted = Array.isArray(filter) ? filter : [filter];
  const picked = enabled.filter((source) => wanted.includes(source.id));
  return picked.length > 0 ? picked : enabled;
}

/** Parses the `source` search param into a filter value. */
export function parseSourceParam(
  value: string | string[] | undefined
): SourceId | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
