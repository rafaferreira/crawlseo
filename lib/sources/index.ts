import { cache } from "react";

import { googleSource } from "./google";
import { bingSource } from "./bing";
import type { DataSource, SourceId } from "./types";

export type { DataSource, SourceId, SourceRow, SourceDailyRow } from "./types";

/** Every source the app knows how to read. Order is display order. */
const SOURCES: DataSource[] = [googleSource, bingSource];

/**
 * The sources actually configured for a site.
 *
 * Wrapped in cache() because a single page render asks this a dozen times over
 * and the answer cannot change mid-render.
 */
export const enabledSources = cache(
  async (siteId: string): Promise<DataSource[]> => {
    const flags = await Promise.all(
      SOURCES.map((source) => source.isEnabled(siteId))
    );
    return SOURCES.filter((_, index) => flags[index]);
  }
);

/**
 * The sources a screen should read, honouring an optional filter.
 *
 * A filter naming a source the site has not connected returns nothing: asking
 * for Google on a Bing-only site has to come back empty, because answering it
 * with Bing's rows labelled Google is how a comparison screen ends up showing
 * a source against itself and calling the agreement perfect.
 *
 * No filter means every connected source. A completely unrecognised value
 * also falls back to everything, so a stale bookmark shows data instead of an
 * empty screen.
 */
export async function resolveSources(
  siteId: string,
  filter?: SourceId | SourceId[] | null
): Promise<DataSource[]> {
  return pickSources(await enabledSources(siteId), filter);
}

/** The selection rule on its own, so it can be tested without a database. */
export function pickSources(
  enabled: DataSource[],
  filter?: SourceId | SourceId[] | null
): DataSource[] {
  if (!filter) return enabled;

  const wanted = Array.isArray(filter) ? filter : [filter];
  const known = wanted.filter((id) => SOURCES.some((source) => source.id === id));
  if (known.length === 0) return enabled;

  return enabled.filter((source) => known.includes(source.id));
}

export function isSourceId(value: string): value is SourceId {
  return SOURCES.some((source) => source.id === value);
}

/**
 * Everything a screen needs to read and label its sources: the ids to query,
 * whether that is all of them, and the props for the filter control.
 */
export async function sourceScope(
  siteId: string,
  sourceParam: string | string[] | undefined
) {
  const requested = (Array.isArray(sourceParam) ? sourceParam[0] : sourceParam) ?? null;
  const [available, active] = await Promise.all([
    enabledSources(siteId),
    resolveSources(siteId, requested as SourceId | null),
  ]);
  const ids = active.map((source) => source.id);
  const showingAll = ids.length === available.length;

  return {
    ids,
    showingAll,
    /** Set when the filter named a source this site has not connected. */
    unavailable: ids.length === 0 && requested ? requested : null,
    filter: {
      sources: available.map(({ id, label }) => ({ id, label })),
      active: showingAll ? "all" : (ids[0] ?? "all"),
      caveat: available
        .map((source) => source.windowCaveat)
        .filter(Boolean)
        .join(" "),
    },
  };
}
