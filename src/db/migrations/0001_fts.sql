-- Full-text search over message content. Standalone (not external-content) so it
-- doesn't depend on rowids staying stable across VACUUM.
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  message_id UNINDEXED,
  conversation_id UNINDEXED
);
--> statement-breakpoint
CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (content, message_id, conversation_id)
  VALUES (new.content, new.id, new.conversation_id);
END;
--> statement-breakpoint
CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE message_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER messages_fts_au AFTER UPDATE OF content ON messages BEGIN
  DELETE FROM messages_fts WHERE message_id = old.id;
  INSERT INTO messages_fts (content, message_id, conversation_id)
  VALUES (new.content, new.id, new.conversation_id);
END;
