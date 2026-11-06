import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ArcticShiftError, get } from "./client.js";
import {
  type Comment,
  type Post,
  type SeriesPoint,
  type Subreddit,
  type TreeNode,
  formatComments,
  formatPosts,
  formatSeries,
  formatSubreddits,
  formatThread,
  parsePostId,
  stripPrefix,
} from "./format.js";

const POST_FIELDS = "id,title,subreddit,author,created_utc,score,num_comments,selftext,url,over_18,link_flair_text";

const ARCHIVE_NOTE =
  "Data comes from the Arctic Shift archive of public Reddit content (no private or quarantined subs). " +
  "Scores and comment counts stay at 0-1 until about 36h after posting.";

const dateParam = (what: string) =>
  z
    .string()
    .optional()
    .describe(`Only items created ${what} this point. ISO date (2026-01-31) or relative offset like 30d, 6m, 1year.`);

const filters = {
  subreddit: z.string().optional().describe("Subreddit name, without r/."),
  author: z.string().optional().describe("Reddit username, without u/."),
  after: dateParam("after"),
  before: dateParam("before"),
};

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

async function run(fn: () => Promise<string>) {
  try {
    return text(await fn());
  } catch (err) {
    if (err instanceof ArcticShiftError) return fail(err.message);
    throw err;
  }
}

const SCAN_PAGES = 5;

async function scanPosts(params: Record<string, string | number | boolean | undefined>, query: string, limit: number) {
  const matches: Post[] = [];
  let scanned = 0;
  let cursor: Record<string, number> = {};
  for (let page = 0; page < SCAN_PAGES && matches.length < limit; page++) {
    const batch = await get<Post[]>("/api/posts/search", { ...params, ...cursor, limit: 100 });
    scanned += batch.length;
    matches.push(...batch.filter((p) => matchesKeywords(`${p.title}\n${p.selftext ?? ""}`, query)));
    if (batch.length < 100) break;
    const last = batch[batch.length - 1].created_utc;
    cursor = params.sort === "asc" ? { after: last + 1 } : { before: last };
  }
  return { matches: matches.slice(0, limit), scanned };
}

export function matchesKeywords(text: string, query: string): boolean {
  // Word-prefix match, so "AI" does not hit "said" but "code" still hits "codebase".
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "iu").test(text));
}

const needsScope =(query: string | undefined, ...scopes: (string | undefined)[]) =>
  query !== undefined && scopes.every((s) => !s);

export function registerTools(server: McpServer): void {
  server.registerTool(
    "search_posts",
    {
      title: "Search Reddit posts",
      description:
        "Search Reddit posts by keyword, subreddit, author and date range, newest first by default. " +
        "Keyword search (query) only works together with a subreddit or author; there is no global keyword search, " +
        "so find relevant communities with search_subreddits first. Returns title, metadata, permalink and a body excerpt. " +
        ARCHIVE_NOTE,
      inputSchema: {
        query: z.string().optional().describe("Keywords matched against title and body. Requires subreddit or author."),
        ...filters,
        sort: z.enum(["desc", "asc"]).default("desc").describe("By creation time: desc = newest first."),
        limit: z.number().int().min(1).max(100).default(25),
        include_nsfw: z.boolean().default(false),
      },
      annotations: readOnly,
    },
    async ({ query, subreddit, author, after, before, sort, limit, include_nsfw }) => {
      if (needsScope(query, subreddit, author)) {
        return fail("query needs a subreddit or author. Use search_subreddits to find communities to search in.");
      }
      return run(async () => {
        const params = { subreddit, author, after, before, sort, over_18: include_nsfw ? undefined : false, fields: POST_FIELDS };
        if (!query) return formatPosts(await get<Post[]>("/api/posts/search", { ...params, limit }));
        try {
          return formatPosts(await get<Post[]>("/api/posts/search", { ...params, query, limit }, false));
        } catch (err) {
          if (!(err instanceof ArcticShiftError)) throw err;
          // Server-side post keyword search is often rejected; scan recent posts instead.
          const { matches, scanned } = await scanPosts(params, query, limit);
          const note =
            `Note: server keyword search failed, so these are local matches for "${query}" among the ` +
            `${scanned} ${sort === "asc" ? "oldest" : "newest"} posts in range. Narrow after/before to reach other periods.`;
          return `${note}\n\n${formatPosts(matches)}`;
        }
      });
    },
  );

  server.registerTool(
    "search_comments",
    {
      title: "Search Reddit comments",
      description:
        "Search Reddit comments by keyword, subreddit, author, post and date range, newest first by default. " +
        "Keyword search (query) needs a subreddit, author or post_id and can be slow on very large subreddits; " +
        "add an after/before range if it times out. " +
        ARCHIVE_NOTE,
      inputSchema: {
        query: z.string().optional().describe("Full-text keywords in the comment body. Requires subreddit, author or post_id."),
        ...filters,
        post_id: z.string().optional().describe("Only comments on this post (id, t3_ id or URL)."),
        sort: z.enum(["desc", "asc"]).default("desc"),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: readOnly,
    },
    async ({ query, subreddit, author, post_id, after, before, sort, limit }) => {
      if (needsScope(query, subreddit, author, post_id)) {
        return fail("query needs a subreddit, author or post_id.");
      }
      return run(async () => {
        const comments = await get<Comment[]>("/api/comments/search", {
          body: query, subreddit, author, after, before, sort, limit,
          link_id: post_id ? parsePostId(post_id) : undefined,
        });
        return formatComments(comments);
      });
    },
  );

  server.registerTool(
    "get_thread",
    {
      title: "Read a Reddit thread",
      description:
        "Read a post with its comment tree, indented by reply depth. Collapsed branches are marked; " +
        "pass comment_id to expand one branch. Accepts a post id, t3_ id or any reddit post URL. " +
        ARCHIVE_NOTE,
      inputSchema: {
        post_id: z.string().describe("Post id, t3_ id or reddit URL."),
        comment_id: z.string().optional().describe("Only return the replies under this comment."),
        max_comments: z.number().int().min(1).max(1000).default(150),
      },
      annotations: readOnly,
    },
    async ({ post_id, comment_id, max_comments }) =>
      run(async () => {
        const id = parsePostId(post_id);
        const [posts, tree] = await Promise.all([
          comment_id ? Promise.resolve([] as Post[]) : get<Post[]>("/api/posts/ids", { ids: id, fields: POST_FIELDS }),
          get<TreeNode[]>("/api/comments/tree", {
            link_id: id,
            parent_id: comment_id ? stripPrefix(comment_id) : undefined,
            limit: max_comments,
            start_breadth: 10,
            start_depth: 4,
          }),
        ]);
        if (!comment_id && posts.length === 0 && tree.length === 0) return `No post with id ${id} in the archive.`;
        return formatThread(posts[0], tree);
      }),
  );

  server.registerTool(
    "search_subreddits",
    {
      title: "Find subreddits",
      description:
        "Find subreddits by name or name prefix, sorted by subscriber count. Matches names only, not descriptions, " +
        "so try several likely prefixes (e.g. 'devops', 'sre', 'kubernetes'). Use it to pick where to search.",
      inputSchema: {
        name_prefix: z.string().optional().describe("Subreddit names starting with this."),
        min_subscribers: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(100).default(20),
        include_nsfw: z.boolean().default(false),
      },
      annotations: readOnly,
    },
    async ({ name_prefix, min_subscribers, limit, include_nsfw }) =>
      run(async () => {
        const subs = await get<Subreddit[]>("/api/subreddits/search", {
          subreddit_prefix: name_prefix, min_subscribers, limit,
          over18: include_nsfw ? undefined : false,
          sort_type: "subscribers",
          sort: "desc",
        });
        return formatSubreddits(subs);
      }),
  );

  server.registerTool(
    "activity_over_time",
    {
      title: "Reddit activity over time",
      description:
        "Count posts or comments per day, month or year matching the filters. Use it to see whether a topic " +
        "or community is growing. Keyword filters need a subreddit or author. Big subreddits over long ranges may " +
        "time out; shorten the range or use a coarser frequency. Recent counts can lag by a day or two.",
      inputSchema: {
        type: z.enum(["posts", "comments"]).default("posts"),
        // "week" is omitted: the API returns all-zero weekly buckets.
        frequency: z.enum(["day", "month", "year"]).default("month"),
        query: z.string().optional().describe("Keywords (title+body for posts, body for comments). Requires subreddit or author."),
        ...filters,
      },
      annotations: readOnly,
    },
    async ({ type, frequency, query, subreddit, author, after, before }) => {
      if (needsScope(query, subreddit, author)) return fail("query needs a subreddit or author.");
      return run(async () => {
        const points = await get<SeriesPoint[]>(`/api/${type}/search/aggregate`, {
          aggregate: "created_utc", frequency, subreddit, author, after, before,
          [type === "posts" ? "query" : "body"]: query,
        });
        return formatSeries(points, frequency);
      });
    },
  );
}
