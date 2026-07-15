ALTER TABLE `people` ADD `clerk_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `people_clerk_user_id_unique` ON `people` (`clerk_user_id`);