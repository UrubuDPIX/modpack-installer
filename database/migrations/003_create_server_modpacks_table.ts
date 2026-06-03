import { PrismaClient } from '@prisma/client';

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS server_modpacks (
      id VARCHAR(36) PRIMARY KEY,
      server_id VARCHAR(36) NOT NULL UNIQUE,
      modpack_id VARCHAR(36) NOT NULL,
      version_id VARCHAR(36) NOT NULL,
      status ENUM('installing', 'installed', 'error') DEFAULT 'installing',
      install_log TEXT,
      installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (modpack_id) REFERENCES modpacks(id) ON DELETE CASCADE,
      FOREIGN KEY (version_id) REFERENCES modpack_versions(id) ON DELETE CASCADE
    )
  `;
}

export async function down(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`DROP TABLE IF EXISTS server_modpacks`;
}
