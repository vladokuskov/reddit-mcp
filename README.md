# reddit-mcp

A local MCP server for browsing Reddit in research sessions. Data comes from [Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift), a free, keyless archive of public Reddit posts and comments.

## Tools

| Tool | What it does |
| --- | --- |
| `search_subreddits` | Find communities by name prefix, sorted by subscribers |
| `search_posts` | Posts by keyword, subreddit, author, date range |
| `search_comments` | Comments by keyword, subreddit, author, post, date range |
| `get_thread` | A post plus its comment tree; `comment_id` expands a collapsed branch |
| `activity_over_time` | Post or comment counts per day, month or year, for trend checks |

Dates accept ISO (`2026-01-31`) or offsets (`30d`, `6m`, `1year`).

## Setup

```sh
npm install
npm run build
claude mcp add reddit -s user -- node "$PWD/dist/index.js"
```

Run `/mcp` in a new Claude Code session to check it is connected. `npm run inspect` opens the MCP Inspector.

## Limits of the archive

- **Keyword search needs a subreddit or author.** There is no global search, so start with `search_subreddits`.
- **Server-side post keyword search is often rejected.** When that happens, `search_posts` scans up to 500 recent posts in the range and matches keywords locally, and says so in its output. Narrow `after`/`before` to search other periods. Comment keyword search works server-side.
- **Weekly aggregation returns zeros upstream**, so `activity_over_time` offers day, month and year only.
- **Throttling.** The API rate-limits by load and answers with HTTP 422/429 "Timeout. Maybe slow down a bit". The client retries once, then returns the error. Daily counts on large subreddits are the usual trigger; use a shorter range or monthly buckets.
- Scores and comment counts stay at 0-1 until about 36h after posting.
- No private or quarantined subreddits. No uptime guarantees.

## Usage terms

This is for internal research. Arctic Shift is a mirror and grants no rights to the content. Commercial reuse of Reddit content, or using it for model training, needs Reddit's data licensing.

## Development

```sh
npm test    # formatter unit tests on recorded fixtures in test/fixtures
```
