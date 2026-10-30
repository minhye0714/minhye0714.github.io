-- Daily browser counts plus a running sum of daily visits (not lifetime people).
CREATE TABLE visitor_stats (
  day TEXT PRIMARY KEY,
  visitors INTEGER NOT NULL DEFAULT 0 CHECK (visitors >= 0)
);

-- Only a day-specific keyed hash; no persistent browser ID, page path or raw IP.
CREATE TABLE visitor_events (
  day TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (day, visitor_hash)
);
