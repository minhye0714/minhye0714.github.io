CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  post TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delete_hash TEXT NOT NULL
);

CREATE INDEX comments_by_post ON comments (post, created_at DESC, id DESC);

CREATE TABLE rate_limits (
  client_key TEXT NOT NULL,
  minute INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (client_key, minute)
);

CREATE INDEX rate_limits_by_minute ON rate_limits (minute);
