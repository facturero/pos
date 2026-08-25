-- AlterTable
ALTER TABLE `categories` MODIFY `remoteId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `products` ADD COLUMN `currencyCode` VARCHAR(191) NOT NULL DEFAULT 'USD',
    MODIFY `remoteId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `sales` MODIFY `remoteId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `pos_config` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `organizationId` VARCHAR(191) NOT NULL,
    `establishmentId` VARCHAR(191) NOT NULL,
    `emissionPointId` VARCHAR(191) NOT NULL,
    `refreshToken` TEXT NOT NULL,
    `pairedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
