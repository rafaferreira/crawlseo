/** One query/day row of Search Console performance data. */
export interface KeywordData {
  query: string;
  page?: string;
  device?: string;
  country?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  date: string;
}
