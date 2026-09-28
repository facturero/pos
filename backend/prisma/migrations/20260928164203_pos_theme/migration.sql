-- CreateTable
CREATE TABLE "pos_theme" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "themeId" TEXT,
    "name" TEXT,
    "source" TEXT NOT NULL DEFAULT 'builtin',
    "version" INTEGER NOT NULL DEFAULT 0,
    "etag" TEXT,
    "configJson" TEXT,
    "assetsJson" TEXT NOT NULL DEFAULT '[]',
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
