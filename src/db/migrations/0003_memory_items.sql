CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`stance` text NOT NULL,
	`strength` text NOT NULL,
	`excerpt` text NOT NULL,
	`origin` text NOT NULL,
	`origin_ref` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `memory_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evidence_item_idx` ON `evidence` (`item_id`);--> statement-breakpoint
CREATE TABLE `memory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local' NOT NULL,
	`startup_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`confidence` text DEFAULT 'low' NOT NULL,
	`importance` integer DEFAULT 3 NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`origin` text NOT NULL,
	`origin_ref` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`supersedes_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `memory_items_kind_idx` ON `memory_items` (`kind`,`status`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local' NOT NULL,
	`type` text NOT NULL,
	`change` text NOT NULL,
	`summary` text NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`origin_ref` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`decided_at` text
);
--> statement-breakpoint
CREATE INDEX `proposals_status_idx` ON `proposals` (`status`);