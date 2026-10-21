CREATE TABLE `atlas_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`domain` text NOT NULL,
	`document_type` text NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text NOT NULL,
	`provider_record_url` text NOT NULL,
	`access_basis` text NOT NULL,
	`full_text_url` text,
	`doi` text,
	`published_at` text,
	`query` text NOT NULL,
	`queries` text DEFAULT '[]' NOT NULL,
	`discovered_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atlas_documents_user_url` ON `atlas_documents` (`user_id`,`url`);--> statement-breakpoint
CREATE INDEX `atlas_documents_user_discovered` ON `atlas_documents` (`user_id`,`discovered_at`);