import { describe, it, expect } from "vitest";
import { pickSources } from "./index";
import type { DataSource, SourceId } from "./types";

const source = (id: SourceId) => ({ id, label: id }) as DataSource;
const google = source("google");
const bing = source("bing");

describe("pickSources", () => {
  it("returns everything when there is no filter", () => {
    expect(pickSources([google, bing])).toEqual([google, bing]);
    expect(pickSources([google, bing], null)).toEqual([google, bing]);
  });

  it("narrows to the named source", () => {
    expect(pickSources([google, bing], "bing")).toEqual([bing]);
    expect(pickSources([google, bing], ["google"])).toEqual([google]);
  });

  it("returns nothing when a real source is not connected to this site", () => {
    // The whole point: answering "give me Google" with Bing's rows is how a
    // comparison screen ends up showing one source against itself and
    // reporting the agreement as perfect.
    expect(pickSources([bing], "google")).toEqual([]);
    expect(pickSources([bing], ["google"])).toEqual([]);
  });

  it("falls back to everything for a value that names no source at all", () => {
    // A stale bookmark should show data, not an empty screen.
    expect(pickSources([google, bing], "yandex" as SourceId)).toEqual([
      google,
      bing,
    ]);
  });

  it("keeps registry order, not filter order", () => {
    expect(pickSources([google, bing], ["bing", "google"])).toEqual([
      google,
      bing,
    ]);
  });
});
