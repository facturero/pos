-- AlterTable
ALTER TABLE `products` ADD COLUMN `priceIncludesTax` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `taxes` JSON NULL;

-- AlterTable
ALTER TABLE `sale_items` ADD COLUMN `discount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `taxAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `taxes` JSON NULL;
