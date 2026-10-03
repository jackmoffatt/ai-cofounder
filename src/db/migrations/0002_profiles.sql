CREATE TABLE `founder` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local' NOT NULL,
	`name` text,
	`profile` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_events` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`summary` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`change` text DEFAULT '{}' NOT NULL,
	`origin` text DEFAULT '{}' NOT NULL,
	`undone_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_events_entity_idx` ON `memory_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `startups` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local' NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`stage` text DEFAULT 'discovery' NOT NULL,
	`current_objective` text DEFAULT '' NOT NULL,
	`profile` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
