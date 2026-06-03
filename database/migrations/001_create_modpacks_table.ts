import { PrismaClient } from '@prisma/client';

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS modpacks (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      author VARCHAR(255) NOT NULL,
      description TEXT,
      icon VARCHAR(500),
      downloads INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `;
}

export async function down(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`DROP TABLE IF EXISTS modpacks`;
}
