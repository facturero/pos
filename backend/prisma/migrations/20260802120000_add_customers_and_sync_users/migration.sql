-- AlterTable: remoteId pasa a VARCHAR (uuid del admin) y passwordHash pasa a
-- nullable (los usuarios sincronizados nacen sin contraseña vinculada).
ALTER TABLE `users`
    MODIFY `remoteId` VARCHAR(191) NULL,
    MODIFY `passwordHash` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `customers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `remoteId` VARCHAR(191) NULL,
    `countryCode` VARCHAR(191) NULL,
    `identificationTypeId` VARCHAR(191) NULL,
    `identification` VARCHAR(191) NULL,
    `businessName` VARCHAR(191) NOT NULL,
    `tradeName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `type` ENUM('PERSON', 'COMPANY') NOT NULL DEFAULT 'PERSON',
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `syncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customers_remoteId_key`(`remoteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_contacts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `remoteId` VARCHAR(191) NULL,
    `customerId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `position` VARCHAR(191) NULL,

    UNIQUE INDEX `customer_contacts_remoteId_key`(`remoteId`),
    INDEX `customer_contacts_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_addresses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `remoteId` VARCHAR(191) NULL,
    `customerId` INTEGER NOT NULL,
    `type` ENUM('BILLING', 'SHIPPING', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `line1` VARCHAR(191) NOT NULL,
    `line2` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `province` VARCHAR(191) NULL,
    `countryCode` VARCHAR(191) NULL,
    `postalCode` VARCHAR(191) NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `customer_addresses_remoteId_key`(`remoteId`),
    INDEX `customer_addresses_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `customer_contacts` ADD CONSTRAINT `customer_contacts_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_addresses` ADD CONSTRAINT `customer_addresses_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
