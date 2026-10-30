CREATE TABLE pageviews (
  post TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0)
);

-- Random per-post visit IDs only; no browser profiles or raw IP addresses.
CREATE TABLE pageview_events (
  id TEXT PRIMARY KEY,
  post TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX pageview_events_by_date ON pageview_events (created_at);
