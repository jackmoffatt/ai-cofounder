CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local' NOT NULL,
	`startup_id` text,
	`objective_id` text,
	`assumption_id` text,
	`hypothesis` text NOT NULL,
	`method` text DEFAULT '' NOT NULL,
	`success_criteria` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`start_date` text,
	`result` text DEFAULT '' NOT NULL,
	`conclusion` text DEFAULT '' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `experiments_status_idx` ON `experiments` (`status`);--> statement-breakpoint
CREATE TABLE `objectives` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local' NOT NULL,
	`startup_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`success_criteria` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_deps` (
	`task_id` text NOT NULL,
	`depends_on_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `depends_on_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local' NOT NULL,
	`startup_id` text,
	`objective_id` text,
	`experiment_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`due_date` text,
	`origin` text NOT NULL,
	`origin_ref` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);