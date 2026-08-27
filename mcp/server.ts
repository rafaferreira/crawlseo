#!/usr/bin/env node

/**
 * CrawlSEO MCP Server
 *
 * Exposes SEO tools over stdio transport so AI agents (Claude Code, etc.)
 * can query site metrics, crawl data, vitals, and opportunities.
 *
 * Run: npx tsx mcp/server.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { db } from "../lib/db";
import {
  getSitePeriodMetrics,
  getTopKeywords,
  getTopPages,
  getDailyTraffic,
} from "../lib/seo-metrics";
import { getAllOpportunities } from "../lib/seo-opportunities";
import { getEngineComparison } from "../lib/bing-metrics";
import { enabledSources, type SourceId } from "../lib/sources";
import { runSiteCrawl } from "../lib/crawler/engine";

import {
  formatSiteOverview,
  formatKeywords,
  formatPages,
  formatTraffic,
  formatCrawlIssues,
  formatVitals,
  formatOpportunities,
  formatEngineGap,
} from "./formatters";

/** Optional narrowing to one source; omitted means every connected one. */
const sourcesParam = z
  .array(z.enum(["google", "bing"]))
  .optional()
  .describe("Limit to these sources (default: every source connected to the site)");

async function sourceNote(siteId: string, sources?: SourceId[]): Promise<string> {
  const connected = (await enabledSources(siteId)).map((source) => source.label);
  const used = sources?.length ? sources : connected.map((l) => l.toLowerCase());
  return `\n\nSources: ${used.join(" + ")} (connected: ${connected.join(", ") || "none"}). Totals are added across sources; Bing reports weekly buckets, so window edges are approximate by up to six days.`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "CrawlSEO",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// 1. list_sites
// ---------------------------------------------------------------------------

server.tool(
  "list_sites",
  "List all monitored sites with their domains and basic info.",
  {},
  async () => {
    const sites = await db.site.findMany({
      select: {
        id: true,
        domain: true,
        gscProperty: true,
        createdAt: true,
        bingSite: true,
        _count: {
          select: {
            crawls: true,
            keywords: true,
            pages: true,
            bingWeekly: true,
            bingDaily: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (sites.length === 0) {
      return { content: [{ type: "text", text: "No sites found." }] };
    }

    const lines = sites.map(
      (s) =>
        `${s.domain}  (id: ${s.id})` +
        `\n  Google: ${s.gscProperty ?? "not connected"}` +
        `\n  Bing:   ${s.bingSite ?? "not connected"}` +
        `\n  Rows: ${s._count.keywords} queries, ${s._count.pages} pages, ` +
        `${s._count.bingWeekly + s._count.bingDaily} bing  |  Crawls: ${s._count.crawls}` +
        `\n  Created: ${s.createdAt.toISOString().slice(0, 10)}`
    );

    return {
      content: [{ type: "text", text: `${sites.length} site(s):\n\n${lines.join("\n\n")}` }],
    };
  }
);

// ---------------------------------------------------------------------------
// 2. get_site_overview
// ---------------------------------------------------------------------------

server.tool(
  "get_site_overview",
  "Get a comprehensive overview of a site including KPIs, health score, and vitals.",
  {
    siteId: z.string().describe("The site ID to get overview for"),
    sources: sourcesParam,
  },
  async ({ siteId, sources }) => {
    const site = await db.site.findUnique({
      where: { id: siteId },
      select: { id: true, domain: true, gscProperty: true },
    });

    if (!site) {
      return { content: [{ type: "text", text: `Site not found: ${siteId}` }] };
    }

    const [metrics, latestCrawl, latestVitals] = await Promise.all([
      getSitePeriodMetrics(siteId, 28, sources),
      db.crawl.findFirst({
        where: { siteId },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          status: true,
          healthScore: true,
          pagesFound: true,
          issuesFound: true,
          finishedAt: true,
        },
      }),
      db.vitalsReport.findFirst({
        where: { siteId },
        orderBy: { date: "desc" },
      }),
    ]);

    const overview = { ...site, metrics, latestCrawl, latestVitals };
    return {
      content: [
        {
          type: "text",
          text: formatSiteOverview(overview) + (await sourceNote(siteId, sources)),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// 3. get_keywords
// ---------------------------------------------------------------------------

server.tool(
  "get_keywords",
  "Get top keywords for a site sorted by clicks.",
  {
    siteId: z.string().describe("The site ID"),
    limit: z.number().optional().default(25).describe("Max keywords to return (default 25)"),
    days: z.number().optional().default(28).describe("Lookback period in days (default 28)"),
    sources: sourcesParam,
  },
  async ({ siteId, limit, days, sources }) => {
    const rows = await getTopKeywords(siteId, days, limit, sources);
    return {
      content: [
        { type: "text", text: formatKeywords(rows) + (await sourceNote(siteId, sources)) },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// 4. get_pages
// ---------------------------------------------------------------------------

server.tool(
  "get_pages",
  "Get top pages for a site sorted by clicks.",
  {
    siteId: z.string().describe("The site ID"),
    limit: z.number().optional().default(25).describe("Max pages to return (default 25)"),
    days: z.number().optional().default(28).describe("Lookback period in days (default 28)"),
    sources: sourcesParam,
  },
  async ({ siteId, limit, days, sources }) => {
    const rows = await getTopPages(siteId, days, limit, sources);
    return {
      content: [
        { type: "text", text: formatPages(rows) + (await sourceNote(siteId, sources)) },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// 5. get_traffic
// ---------------------------------------------------------------------------

server.tool(
  "get_traffic",
  "Get daily traffic data (clicks and impressions) for a site.",
  {
    siteId: z.string().describe("The site ID"),
    days: z.number().optional().default(90).describe("Lookback period in days (default 90)"),
    sources: sourcesParam,
  },
  async ({ siteId, days, sources }) => {
    const traffic = await getDailyTraffic(siteId, days, sources);
    return {
      content: [
        { type: "text", text: formatTraffic(traffic) + (await sourceNote(siteId, sources)) },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// 6. run_crawl
// ---------------------------------------------------------------------------

server.tool(
  "run_crawl",
  "Start a new site crawl. Returns the crawl ID immediately; the crawl runs in the background.",
  {
    siteId: z.string().describe("The site ID to crawl"),
    maxPages: z.number().optional().default(200).describe("Maximum pages to crawl (default 200)"),
  },
  async ({ siteId, maxPages }) => {
    const site = await db.site.findUnique({
      where: { id: siteId },
      select: { id: true, domain: true },
    });

    if (!site) {
      return { content: [{ type: "text", text: `Site not found: ${siteId}` }] };
    }

    // Update default max pages if specified
    if (maxPages && maxPages !== 200) {
      await db.crawl.updateMany({
        where: { siteId, status: "PENDING" },
        data: { maxPages },
      });
    }

    // Fire and forget — the crawl runs in the background
    const crawlPromise = runSiteCrawl(siteId, site.domain);
    crawlPromise.catch((err) => {
      console.error(`Crawl failed for site ${siteId}:`, err);
    });

    // Give it a moment to create the crawl record
    await new Promise((resolve) => setTimeout(resolve, 500));

    const crawl = await db.crawl.findFirst({
      where: { siteId },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true },
    });

    return {
      content: [
        {
          type: "text",
          text: crawl
            ? `Crawl started.\nCrawl ID: ${crawl.id}\nStatus: ${crawl.status}\n\nUse get_crawl_status to check progress.`
            : `Crawl initiated for ${site.domain}. Check back shortly.`,
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// 7. get_crawl_status
// ---------------------------------------------------------------------------

server.tool(
  "get_crawl_status",
  "Check the status of a crawl by its ID.",
  { crawlId: z.string().describe("The crawl ID to check") },
  async ({ crawlId }) => {
    const crawl = await db.crawl.findUnique({
      where: { id: crawlId },
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        pagesFound: true,
        issuesFound: true,
        healthScore: true,
        maxPages: true,
      },
    });

    if (!crawl) {
      return { content: [{ type: "text", text: `Crawl not found: ${crawlId}` }] };
    }

    const lines = [
      `Crawl: ${crawl.id}`,
      `Status: ${crawl.status}`,
      `Pages found: ${crawl.pagesFound} / ${crawl.maxPages} max`,
      `Issues found: ${crawl.issuesFound}`,
      `Health score: ${crawl.healthScore ?? "pending"}/100`,
      `Started: ${crawl.startedAt?.toISOString().slice(0, 16) ?? "-"}`,
      `Finished: ${crawl.finishedAt?.toISOString().slice(0, 16) ?? "-"}`,
    ];

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ---------------------------------------------------------------------------
// 8. get_crawl_issues
// ---------------------------------------------------------------------------

server.tool(
  "get_crawl_issues",
  "Get issues found during a crawl, optionally filtered by severity.",
  {
    crawlId: z.string().describe("The crawl ID"),
    severity: z
      .string()
      .optional()
      .describe("Filter by severity: CRITICAL, WARNING, or INFO"),
    limit: z.number().optional().default(50).describe("Max issues to return (default 50)"),
  },
  async ({ crawlId, severity, limit }) => {
    const where: any = { crawlId };
    if (severity) {
      where.severity = severity.toUpperCase();
    }

    const issues = await db.crawlIssue.findMany({
      where,
      take: limit,
      orderBy: [{ severity: "asc" }, { type: "asc" }],
      select: {
        severity: true,
        type: true,
        url: true,
        message: true,
      },
    });

    return { content: [{ type: "text", text: formatCrawlIssues(issues) }] };
  }
);

// ---------------------------------------------------------------------------
// 9. get_vitals
// ---------------------------------------------------------------------------

server.tool(
  "get_vitals",
  "Get Core Web Vitals reports for a site.",
  {
    siteId: z.string().describe("The site ID"),
    limit: z.number().optional().default(10).describe("Max reports to return (default 10)"),
  },
  async ({ siteId, limit }) => {
    const vitals = await db.vitalsReport.findMany({
      where: { siteId },
      orderBy: { date: "desc" },
      take: limit,
    });

    return { content: [{ type: "text", text: formatVitals(vitals) }] };
  }
);

// ---------------------------------------------------------------------------
// 10. get_opportunities
// ---------------------------------------------------------------------------

server.tool(
  "get_opportunities",
  "Get SEO opportunities: striking-distance keywords, low-CTR keywords, content decay, and cannibalization.",
  { siteId: z.string().describe("The site ID") },
  async ({ siteId }) => {
    const opportunities = await getAllOpportunities(siteId);
    return { content: [{ type: "text", text: formatOpportunities(opportunities) }] };
  }
);

/// ---------------------------------------------------------------------------
// 11. compare_sources
// ---------------------------------------------------------------------------

server.tool(
  "compare_sources",
  "Compare the queries Google and Bing report for a site: which one sees a query at all, and where each ranks it. Volume is never summed across sources here.",
  {
    siteId: z.string().describe("The site ID"),
    days: z.number().optional().default(90).describe("Lookback period in days (default 90)"),
    limit: z.number().optional().default(25).describe("Max rows to return (default 25)"),
    seenBy: z
      .enum(["all", "both", "bing", "google"])
      .optional()
      .default("all")
      .describe("Filter to queries only one engine reports (default all)"),
  },
  async ({ siteId, days, limit, seenBy }) => {
    const { rows, counts } = await getEngineComparison(siteId, days);
    const filtered = seenBy === "all" ? rows : rows.filter((row) => row.presence === seenBy);
    return {
      content: [
        { type: "text", text: formatEngineGap(filtered.slice(0, limit), counts) },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("CrawlSEO MCP server running on stdio");
}

main().catch((err) => {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
});
