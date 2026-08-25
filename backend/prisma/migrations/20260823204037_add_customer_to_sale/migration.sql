-- AlterTable
ALTER TABLE `sales` ADD COLUMN `customerId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `sales_customerId_idx` ON `sales`(`customerId`);

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
