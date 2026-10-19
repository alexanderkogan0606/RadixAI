CREATE TABLE `atlas_bookmarks` (
	`user_id` text NOT NULL,
	`resource_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atlas_bookmarks_user_resource` ON `atlas_bookmarks` (`user_id`,`resource_id`);--> statement-breakpoint
CREATE TABLE `atlas_chat` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `atlas_chat_user_created` ON `atlas_chat` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `atlas_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`source` text NOT NULL,
	`target` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atlas_edges_user_job_pair` ON `atlas_edges` (`user_id`,`job_id`,`source`,`target`);--> statement-breakpoint
CREATE TABLE `atlas_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`time` text NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`url` text
);
--> statement-breakpoint
CREATE INDEX `atlas_events_user_time` ON `atlas_events` (`user_id`,`time`);--> statement-breakpoint
CREATE TABLE `atlas_hosts` (
	`host` text PRIMARY KEY NOT NULL,
	`next_allowed_at` integer DEFAULT 0 NOT NULL,
	`robots_text` text,
	`robots_status` integer,
	`robots_fetched_at` integer,
	`crawl_delay` integer DEFAULT 1000 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `atlas_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`query` text NOT NULL,
	`status` text NOT NULL,
	`scope` text NOT NULL,
	`max_pages` integer NOT NULL,
	`max_depth` integer NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`indexed` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`seed_hosts` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `atlas_jobs_user` ON `atlas_jobs` (`user_id`);--> statement-breakpoint
CREATE TABLE `atlas_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`source_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`domain` text NOT NULL,
	`category` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`depth` integer NOT NULL,
	`parent_url` text,
	`fetched_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atlas_pages_user_job_url` ON `atlas_pages` (`user_id`,`job_id`,`url`);--> statement-breakpoint
CREATE TABLE `atlas_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`source_id` text NOT NULL,
	`url` text NOT NULL,
	`domain` text NOT NULL,
	`category` text NOT NULL,
	`depth` integer NOT NULL,
	`parent_url` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atlas_queue_user_job_url` ON `atlas_queue` (`user_id`,`job_id`,`url`);--> statement-breakpoint
CREATE INDEX `atlas_queue_pending` ON `atlas_queue` (`job_id`,`status`);--> statement-breakpoint
CREATE TABLE `atlas_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`domain` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atlas_sources_user_url` ON `atlas_sources` (`user_id`,`url`);