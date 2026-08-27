import type { SourceRow } from "./types";

export type MergedRow = {
  label: string;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
};

/**
 * Merges rows that share a key across sources.
 *
 * Volume adds up, positions are averaged weighted by impressions (the same way
 * they are already averaged across days inside one source), and CTR is
 * recomputed from the merged totals rather than averaged - averaging two CTRs
 * would weigh a 1-impression row like a 1,000-impression one.
 *
 * The first source to report a key owns the label, which is why the registry
 * lists Google first: the rest of the app links to Search Console's URL form.
 */
export function mergeSourceRows(batches: SourceRow[][]): MergedRow[] {
  const merged = new Map<
    string,
    {
      label: string;
      clicks: number;
      impressions: number;
      weighted: number;
      weight: number;
    }
  >();

  for (const batch of batches) {
    for (const row of batch) {
      const entry = merged.get(row.key) ?? {
        label: row.label,
        clicks: 0,
        impressions: 0,
        weighted: 0,
        weight: 0,
      };
      entry.clicks += row.clicks;
      entry.impressions += row.impressions;
      if (row.position != null && row.position > 0) {
        const weight = Math.max(row.impressions, 1);
        entry.weighted += row.position * weight;
        entry.weight += weight;
      }
      merged.set(row.key, entry);
    }
  }

  return Array.from(merged.values())
    .map((entry) => ({
      label: entry.label,
      clicks: entry.clicks,
      impressions: entry.impressions,
      position: entry.weight > 0 ? entry.weighted / entry.weight : 0,
      ctr: entry.impressions > 0 ? entry.clicks / entry.impressions : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}
