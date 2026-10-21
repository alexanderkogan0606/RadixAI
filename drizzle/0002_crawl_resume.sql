ALTER TABLE `atlas_queue` ADD `next_attempt_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `atlas_queue` ADD `fetch_state` text;