import { Migration } from '@prisma/client';

export async function up(prisma: any) {
  const hasTable = await prisma.$queryRaw`
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = DATABASE() 
    AND table_name = 'modpack_settings'
  `;

  if (hasTable.length === 0) {
    await prisma.$executeRaw`
      CREATE TABLE modpack_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        
        key VARCHAR(255) NOT NULL UNIQUE,
        value TEXT,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `;

    // Insert default settings
    await prisma.$executeRaw`
      INSERT INTO modpack_settings (key, value) VALUES
      ('curseforge_api_key', ''),
      ('modrinth_enabled', '1'),
      ('curseforge_enabled', '0'),
      ('default_loader', 'forge')
    `;
  }
}

export async function down(prisma: any) {
  await prisma.$executeRaw`DROP TABLE IF EXISTS modpack_settings`;
}
