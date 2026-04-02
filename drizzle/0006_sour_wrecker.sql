CREATE TABLE `bling_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`cnpj` varchar(20),
	`clientId` varchar(255) NOT NULL,
	`clientSecret` varchar(255) NOT NULL,
	`accessToken` text NOT NULL DEFAULT (''),
	`refreshToken` text NOT NULL DEFAULT (''),
	`tokenExpiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bling_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ncm_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` int NOT NULL,
	`productId` int,
	`sku` varchar(255) NOT NULL,
	`ncm` varchar(20),
	`origem` int,
	`cest` varchar(20),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ncm_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `ncm_cache_account_sku_idx` UNIQUE(`accountId`,`sku`)
);
--> statement-breakpoint
CREATE TABLE `sync_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sourceAccountId` int NOT NULL,
	`destAccountId` int NOT NULL,
	`syncDate` varchar(10) NOT NULL,
	`status` enum('success','error','partial') NOT NULL,
	`nfeId` varchar(64),
	`nfeNumber` varchar(64),
	`totalItems` int DEFAULT 0,
	`totalValue` decimal(12,2),
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sync_history_id` PRIMARY KEY(`id`)
);
