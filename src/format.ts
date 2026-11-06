export interface Post {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  created_utc: number;
  score: number;
  num_comments: number;
  selftext?: string;
  url?: string;
  permalink?: string;
  over_18?: boolean;
  link_flair_text?: string | null;
}

export interface Comment {
  id: string;
  author: string;
  body: string;
  subreddit: string;
  created_utc: number;
  score: number;
  link_id: string;
  parent_id: string;
  permalink?: string;
  link_title?: string;
}

export type TreeNode =
  | { kind: "t1"; data: Comment & { replies?: { data: { children: TreeNode[] } } | string } }
  | { kind: "more"; data: { count: number; parent_id: string; children: string[] } };

export interface Subreddit {
  display_name: string;
  subscribers: number | null;
  created_utc: number;
  public_description?: string;
  title?: string;
  over18?: boolean;
  _meta?: { num_posts?: number; num_comments?: number };
}

export interface SeriesPoint {
  created_utc: string;
  count: string | number;
}

const REDDIT = "https://www.reddit.com";

export function date(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

export function truncate(text: string | undefined, max: number): string {
  if (!text) return "";
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max)}… [truncated, ${clean.length} chars total]` : clean;
}

function indent(text: string, prefix: string): string {
  return text.split("\n").map((line) => prefix + line).join("\n");
}

export function postUrl(p: Pick<Post, "subreddit" | "id" | "permalink">): string {
  return p.permalink ? REDDIT + p.permalink : `${REDDIT}/r/${p.subreddit}/comments/${p.id}/`;
}

export function commentUrl(c: Comment): string {
  return c.permalink
    ? REDDIT + c.permalink
    : `${REDDIT}/r/${c.subreddit}/comments/${stripPrefix(c.link_id)}/_/${c.id}/`;
}

export function stripPrefix(id: string): string {
  return id.replace(/^t\d_/, "");
}

/** Accepts a bare id, a t3_ id or any reddit post URL. */
export function parsePostId(input: string): string {
  const fromUrl = input.match(/\/comments\/([a-z0-9]+)/i);
  if (fromUrl) return fromUrl[1];
  const fromShort = input.match(/redd\.it\/([a-z0-9]+)/i);
  if (fromShort) return fromShort[1];
  return stripPrefix(input.trim());
}

function isSelfPost(p: Post): boolean {
  return !p.url || p.url.includes(`/comments/${p.id}`);
}

function postHeader(p: Post): string {
  const meta = [
    `r/${p.subreddit}`,
    `u/${p.author}`,
    date(p.created_utc),
    `score ${p.score}`,
    `${p.num_comments} comments`,
    `id ${p.id}`,
    p.link_flair_text ? `flair "${p.link_flair_text}"` : undefined,
    p.over_18 ? "NSFW" : undefined,
  ].filter(Boolean);
  const lines = [p.title, meta.join(" · "), postUrl(p)];
  if (!isSelfPost(p)) lines.push(`Links to: ${p.url}`);
  return lines.join("\n");
}

const EMPTY = "No results. Try widening the date range, removing filters or using different keywords.";

export function formatPosts(posts: Post[], bodyChars = 500): string {
  if (posts.length === 0) return EMPTY;
  return posts
    .map((p, i) => {
      const body = truncate(p.selftext, bodyChars);
      return `[${i + 1}] ${postHeader(p)}${body ? `\n${indent(body, "    ")}` : ""}`;
    })
    .join("\n\n");
}

export function formatComments(comments: Comment[], bodyChars = 600): string {
  if (comments.length === 0) return EMPTY;
  return comments
    .map((c, i) => {
      const meta = [`u/${c.author}`, `r/${c.subreddit}`, date(c.created_utc), `score ${c.score}`, `id ${c.id}`];
      const on = c.link_title ? `\nOn post: "${c.link_title}" (post id ${stripPrefix(c.link_id)})` : "";
      return `[${i + 1}] ${meta.join(" · ")}${on}\n${commentUrl(c)}\n${indent(truncate(c.body, bodyChars), "    ")}`;
    })
    .join("\n\n");
}

export function formatTree(nodes: TreeNode[], bodyChars = 1000, depth = 0): string[] {
  const out: string[] = [];
  const pad = "  ".repeat(depth);
  for (const node of nodes) {
    if (node.kind === "more") {
      const parent = node.data.parent_id;
      const how = parent.startsWith("t1_")
        ? `expand with get_thread comment_id=${stripPrefix(parent)}`
        : "raise max_comments to see more";
      out.push(`${pad}[+${node.data.count} more replies collapsed; ${how}]`);
      continue;
    }
    const c = node.data;
    out.push(`${pad}- u/${c.author} · score ${c.score} · ${date(c.created_utc)} · id ${c.id}`);
    out.push(indent(truncate(c.body, bodyChars), `${pad}  `));
    if (c.replies && typeof c.replies === "object") {
      out.push(...formatTree(c.replies.data.children, bodyChars, depth + 1));
    }
  }
  return out;
}

export function formatThread(post: Post | undefined, tree: TreeNode[], postChars = 4000): string {
  const parts: string[] = [];
  if (post) {
    parts.push(postHeader(post));
    const body = truncate(post.selftext, postChars);
    if (body) parts.push(body);
    parts.push("--- Comments ---");
  }
  parts.push(tree.length ? formatTree(tree).join("\n") : "No comments archived for this thread.");
  return parts.join("\n\n");
}

export function formatSubreddits(subs: Subreddit[]): string {
  if (subs.length === 0) return EMPTY;
  return subs
    .map((s, i) => {
      const meta = [
        `${s.subscribers?.toLocaleString("en-US") ?? "?"} subscribers`,
        `created ${date(s.created_utc)}`,
        s._meta?.num_posts !== undefined ? `${s._meta.num_posts.toLocaleString("en-US")} archived posts` : undefined,
        s.over18 ? "NSFW" : undefined,
      ].filter(Boolean);
      const desc = truncate(s.public_description || s.title, 300);
      return `[${i + 1}] r/${s.display_name} · ${meta.join(" · ")}${desc ? `\n    ${desc}` : ""}`;
    })
    .join("\n");
}

export function formatSeries(points: SeriesPoint[], frequency: string): string {
  if (points.length === 0) return EMPTY;
  const len = frequency === "year" ? 4 : frequency === "month" ? 7 : 10;
  // Buckets start at server-local midnight (e.g. 22:00Z), so shift before taking the date.
  const label = (iso: string) => new Date(Date.parse(iso) + 12 * 3600_000).toISOString().slice(0, len);
  const rows = points.map((p) => ({ label: label(p.created_utc), count: Number(p.count) }));
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return [
    `${frequency} | count`,
    ...rows.map((r) => `${r.label} | ${r.count}`),
    `total | ${total}`,
  ].join("\n");
}
