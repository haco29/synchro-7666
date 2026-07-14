CREATE TABLE `assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_id` integer NOT NULL,
	`date` text NOT NULL,
	`slot` text NOT NULL,
	`person_id` integer NOT NULL,
	FOREIGN KEY (`week_id`) REFERENCES `weeks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignments_week_date_slot_person_unq` ON `assignments` (`week_id`,`date`,`slot`,`person_id`);--> statement-breakpoint
CREATE INDEX `idx_assignments_week` ON `assignments` (`week_id`);--> statement-breakpoint
CREATE TABLE `constraints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`kind` text DEFAULT 'unavailable_date' NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `constraints_person_kind_value_unq` ON `constraints` (`person_id`,`kind`,`value`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_team_name_unq` ON `people` (`team_id`,`name`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`clerk_org_id` text,
	`share_token` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_clerk_org_id_unique` ON `teams` (`clerk_org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `teams_share_token_unique` ON `teams` (`share_token`);--> statement-breakpoint
CREATE TABLE `weeks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`week_start` text NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weeks_team_start_unq` ON `weeks` (`team_id`,`week_start`);