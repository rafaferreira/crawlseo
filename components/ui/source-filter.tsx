"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Layers } from "lucide-react";

/**
 * Which sources a screen is showing, and a way to narrow it to one.
 *
 * With a single source connected there is nothing to choose, so it renders as
 * a plain label rather than a control that does nothing.
 */
export function SourceFilter({
  sources,
  active,
  caveat,
}: {
  sources: { id: string; label: string }[];
  active: string;
  caveat?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (sources.length === 0) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
        <Layers className="size-3" />
        <span>No source connected</span>
      </div>
    );
  }

  if (sources.length === 1) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
        <Layers className="size-3" />
        <span>{sources[0].label}</span>
      </div>
    );
  }

  const allLabel = sources.map((source) => source.label).join(" + ");

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("source");
    else params.set("source", value);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <label
      className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 py-1 pl-2.5 pr-1.5 text-[11px] text-primary"
      title={caveat}
    >
      <Layers className="size-3" />
      <span className="sr-only">Data source</span>
      <select
        value={active}
        onChange={(event) => handleChange(event.target.value)}
        className="cursor-pointer bg-transparent pr-1 text-[11px] font-medium text-primary outline-none"
      >
        <option value="all">{allLabel}</option>
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.label} only
          </option>
        ))}
      </select>
    </label>
  );
}
