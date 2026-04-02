ALTER TABLE `ncm_cache` DROP INDEX `ncm_cache_account_product_idx`;--> statement-breakpoint
ALTER TABLE `ncm_cache` MODIFY COLUMN `productId` int;--> statement-breakpoint
ALTER TABLE `ncm_cache` ADD CONSTRAINT `ncm_cache_account_sku_idx` UNIQUE(`accountId`,`sku`);