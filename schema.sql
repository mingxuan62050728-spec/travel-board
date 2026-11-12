CREATE TABLE IF NOT EXISTS entities (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (kind, id)
) STRICT;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL
) STRICT;

INSERT OR IGNORE INTO meta (key, revision) VALUES ('state', 0);
