-- Keyword search over memory items for retrieval. Standalone FTS table kept in sync by triggers.
CREATE VIRTUAL TABLE memory_items_fts USING fts5(
  title,
  body,
  item_id UNINDEXED
);
--> statement-breakpoint
INSERT INTO memory_items_fts (title, body, item_id) SELECT title, body, id FROM memory_items;
--> statement-breakpoint
CREATE TRIGGER memory_items_fts_ai AFTER INSERT ON memory_items BEGIN
  INSERT INTO memory_items_fts (title, body, item_id) VALUES (new.title, new.body, new.id);
END;
--> statement-breakpoint
CREATE TRIGGER memory_items_fts_ad AFTER DELETE ON memory_items BEGIN
  DELETE FROM memory_items_fts WHERE item_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER memory_items_fts_au AFTER UPDATE OF title, body ON memory_items BEGIN
  DELETE FROM memory_items_fts WHERE item_id = old.id;
  INSERT INTO memory_items_fts (title, body, item_id) VALUES (new.title, new.body, new.id);
END;
