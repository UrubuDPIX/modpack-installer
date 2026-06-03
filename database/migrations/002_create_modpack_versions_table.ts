import { PrismaClient } from '@prisma/client';

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS modpack_versions (
      id VARCHAR(36) PRIMARY KEY,
      modpack_id VARCHAR(36) NOT NULL,
      name VARCHAR(100) NOT NULL,
      minecraft_version VARCHAR(50) NOT NULL,
      loader ENUM('Forge', 'Fabric', 'NeoForge', 'Quilt') NOT NULL,
      loader_version VARCHAR(50) NOT NULL,
      size VARCHAR(20) NOT NULL,
      download_url VARCHAR(500) NOT NULL,
      is_server_pack BOOLEAN DEFAULT TRUE,
      is_release BOOLEAN DEFAULT TRUE,
      changelog TEXT,
      released_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (modpack_id) REFERENCES modpacks(id) ON DELETE CASCADE
    )
  `;
}

export async function down(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`DROP TABLE IF EXISTS modpack_versions`;
}
