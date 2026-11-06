import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatComments,
  formatPosts,
  formatSeries,
  formatSubreddits,
  formatThread,
  parsePostId,
  truncate,
} from "../src/format.js";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")).data;

describe("parsePostId", () => {
  it.each([
    ["1x79wxj", "1x79wxj"],
    ["t3_1x79wxj", "1x79wxj"],
    ["https://www.reddit.com/r/ExperiencedDevs/comments/1x79wxj/some_title/", "1x79wxj"],
    ["https://old.reddit.com/r/x/comments/1x79wxj/t/ph34u9u/?context=3", "1x79wxj"],
    ["https://redd.it/1x79wxj", "1x79wxj"],
  ])("%s -> %s", (input, id) => expect(parsePostId(input)).toBe(id));
});

describe("truncate", () => {
  it("keeps short text and marks cut text", () => {
    expect(truncate("  hi  ", 10)).toBe("hi");
    expect(truncate("abcdef", 3)).toBe("abc… [truncated, 6 chars total]");
    expect(truncate(undefined, 3)).toBe("");
  });
});

describe("formatPosts", () => {
  it("renders numbered posts with permalinks", () => {
    const out = formatPosts(fixture("posts"));
    expect(out).toMatch(/^\[1\] /);
    expect(out).toContain("https://www.reddit.com/r/ExperiencedDevs/comments/");
    expect(out).toMatch(/r\/ExperiencedDevs · u\/\S+ · \d{4}-\d{2}-\d{2} · score -?\d+ · \d+ comments · id \w+/);
  });

  it("shows external links only for link posts", () => {
    const base = { id: "a1", title: "T", subreddit: "s", author: "u", created_utc: 0, score: 1, num_comments: 0 };
    expect(formatPosts([{ ...base, url: "https://example.com/x" }])).toContain("Links to: https://example.com/x");
    expect(formatPosts([{ ...base, url: "https://www.reddit.com/r/s/comments/a1/t/" }])).not.toContain("Links to");
  });

  it("explains empty results", () => {
    expect(formatPosts([])).toMatch(/No results/);
  });
});

describe("formatComments", () => {
  it("includes the parent post title and a comment permalink", () => {
    const out = formatComments(fixture("comments"));
    expect(out).toContain('On post: "');
    expect(out).toMatch(/https:\/\/www\.reddit\.com\/r\/ExperiencedDevs\/comments\/\w+\/[^/]+\/\w+\//);
  });
});

describe("formatThread", () => {
  const out = formatThread(fixture("post_by_id")[0], fixture("tree"));
  const lines = out.split("\n");

  it("starts with the post, then comments", () => {
    expect(lines[0]).not.toMatch(/^- /);
    expect(out).toContain("--- Comments ---");
  });

  it("indents replies by depth", () => {
    expect(lines.some((l) => l.startsWith("- u/"))).toBe(true);
    expect(lines.some((l) => l.startsWith("  - u/"))).toBe(true);
    expect(lines.some((l) => l.startsWith("    - u/"))).toBe(true);
  });

  it("marks collapsed branches with how to expand them", () => {
    expect(out).toContain("[+11 more replies collapsed; expand with get_thread comment_id=ph34u9u]");
    expect(out).toContain("[+119 more replies collapsed; raise max_comments to see more]");
  });

  it("handles a subtree without a post", () => {
    expect(formatThread(undefined, [])).toBe("No comments archived for this thread.");
  });
});

describe("formatSubreddits", () => {
  it("lists name, subscribers and description", () => {
    const out = formatSubreddits(fixture("subreddits"));
    expect(out).toMatch(/^\[1\] r\/\w+ · [\d,]+ subscribers · created \d{4}-\d{2}-\d{2}/);
  });
});

describe("formatSeries", () => {
  it("labels server-local buckets by their real month and totals them", () => {
    const out = formatSeries(fixture("aggregate"), "month");
    const rows = out.split("\n");
    expect(rows[0]).toBe("month | count");
    expect(rows[1]).toBe("2026-05 | 895");
    expect(rows).toContain("2026-11 | 104");
    expect(rows.at(-1)).toBe("total | 4463");
  });
});

describe("matchesKeywords", async () => {
  const { matchesKeywords } = await import("../src/tools.js");
  it("requires every term, case-insensitively", () => {
    expect(matchesKeywords("Our Code Review process", "code review")).toBe(true);
    expect(matchesKeywords("review of the codebase", "code review")).toBe(true);
    expect(matchesKeywords("Code only", "code review")).toBe(false);
    expect(matchesKeywords("he said so", "AI")).toBe(false);
    expect(matchesKeywords("Using AI tools (c++)", "ai c++")).toBe(true);
  });
});
