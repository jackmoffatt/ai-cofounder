CREATE TABLE `agent_traces` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text,
	`mode` text NOT NULL,
	`context` text NOT NULL,
	`outputs` text DEFAULT '{}' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_traces_conv_idx` ON `agent_traces` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `startup_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local' NOT NULL,
	`startup_id` text,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`next_action` text DEFAULT '{}' NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `startup_briefs_created_idx` ON `startup_briefs` (`created_at`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `summary` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `summary_count` integer DEFAULT 0 NOT NULL;