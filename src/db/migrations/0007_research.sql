CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`tool` text NOT NULL,
	`args` text NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` text NOT NULL,
	`decided_at` text
);
--> statement-breakpoint
CREATE TABLE `competitors` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local' NOT NULL,
	`startup_id` text,
	`company` text NOT NULL,
	`product` text DEFAULT '' NOT NULL,
	`target_customer` text DEFAULT '' NOT NULL,
	`value_proposition` text DEFAULT '' NOT NULL,
	`pricing` text DEFAULT '' NOT NULL,
	`business_model` text DEFAULT '' NOT NULL,
	`strengths` text DEFAULT '' NOT NULL,
	`weaknesses` text DEFAULT '' NOT NULL,
	`field_sources` text DEFAULT '{}' NOT NULL,
	`last_researched` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `competitors_company_idx` ON `competitors` (`company`);--> statement-breakpoint
CREATE TABLE `research_sources` (
	`item_id` text NOT NULL,
	`source_id` text NOT NULL,
	`quote` text NOT NULL,
	PRIMARY KEY(`item_id`, `source_id`),
	FOREIGN KEY (`item_id`) REFERENCES `memory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`publisher` text DEFAULT '' NOT NULL,
	`fetched_at` text NOT NULL,
	`content_hash` text DEFAULT '' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`ok` integer DEFAULT true NOT NULL,
	`error` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sources_url_idx` ON `sources` (`url`);