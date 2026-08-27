/**
 * A source of search data for a site.
 *
 * Every screen reads through the registry rather than through one provider, so
 * adding a source (Cloudflare analytics, a rank tracker, anything else that can
 * answer "which queries, which pages, how much traffic") means writing one file
 * here and nothing else. Sources declare what they can supply: a source that
 * only knows traffic never gets asked for queries.
 */

export type SourceId = string;

export interface SourceRow {
  /** Match key across sources: normalised query, or normalised URL. */
  key: string;
  /** How this source spelled it, used for display when it wins the row. */
  label: string;
  clicks: number;
  impressions: number;
  /** Null when the source cannot report a position for this row. */
  position: number | null;
}

export interface SourceDailyRow {
  date: string; // YYYY-MM-DD
  clicks: number;
  impressions: number;
}

export interface DataSource {
  id: SourceId;
  label: string;
  supplies: {
    queries: boolean;
    pages: boolean;
    traffic: boolean;
  };
  /**
   * Whether this source is configured for the site. Google is available as
   * soon as a property is connected; others need their own credentials.
   */
  isEnabled(siteId: string): Promise<boolean>;
  queryRows(siteId: string, start: Date, end: Date): Promise<SourceRow[]>;
  pageRows(siteId: string, start: Date, end: Date): Promise<SourceRow[]>;
  dailyTraffic(
    siteId: string,
    start: Date,
    end: Date
  ): Promise<SourceDailyRow[]>;
  /**
   * Set when a source cannot line its rows up with a day-based window, so the
   * UI can say so instead of implying precision it does not have.
   */
  windowCaveat?: string;
}
