CREATE TABLE `ncm_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` int NOT NULL,
	`productId` int NOT NULL,
	`sku` varchar(255) NOT NULL,
	`ncm` varchar(20),
	`origem` int,
	`cest` varchar(20),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ncm_cache_id` PRIMARY KEY(`id`)
);
