import { prisma } from '../index';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);

interface InstallResult {
  jobId: string;
}

export async function installModpack(
  serverId: string,
  modpackId: string,
  versionId: string,
  action: string
): Promise<InstallResult> {
  // Busca dados do modpack e versão
  const version = await prisma.modpackVersion.findUnique({
    where: { id: BigInt(versionId) },
    include: { modpack: true }
  });

  if (!version) {
    throw new Error('Versão não encontrada');
  }

  // Limpa instalação anterior
  await prisma.serverModpack.deleteMany({
    where: { server_id: BigInt(serverId) }
  });

  // Cria novo registro
  const serverModpack = await prisma.serverModpack.create({
    data: {
      server_id: BigInt(serverId),
      modpack_id: BigInt(modpackId),
      modpack_version_id: BigInt(versionId),
      status: 'installing',
      installed_at: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    }
  });

  // Inicia instalação em background
  processInstallation(serverId, version).catch(console.error);

  return { jobId: String(serverModpack.id) };
}

async function processInstallation(
  serverId: string,
  version: any
) {
  const log: string[] = [];
  const serverIdNum = BigInt(serverId);
  
  try {
    log.push(`[${new Date().toISOString()}] Iniciando instalação: ${version.modpack.name} ${version.version}`);
    
    // Diretório do servidor (exemplo - ajustar conforme estrutura Jexactyl)
    const serverDir = `/var/lib/pterodactyl/volumes/${serverId}`;
    
    // Download do modpack
    log.push(`[${new Date().toISOString()}] Baixando modpack...`);
    const downloadPath = path.join(serverDir, 'modpack.zip');
    await downloadFile(version.download_url, downloadPath);
    log.push(`[${new Date().toISOString()}] Download concluído: ${version.file_size}`);
    
    // Backup se necessário
    const worldBackup = path.join(serverDir, 'world_backup');
    await execAsync(`cp -r ${path.join(serverDir, 'world')} ${worldBackup}`).catch(() => {});
    
    // Limpa arquivos antigos
    log.push(`[${new Date().toISOString()}] Limpando instalação anterior...`);
    await cleanServerDirectory(serverDir);
    
    // Extrai modpack
    log.push(`[${new Date().toISOString()}] Extraindo arquivos...`);
    await execAsync(`cd ${serverDir} && unzip -o modpack.zip && rm modpack.zip`);
    
    // Move arquivos do server pack se existir
    const overridesDir = path.join(serverDir, 'overrides');
    if (await directoryExists(overridesDir)) {
      await execAsync(`cp -r ${overridesDir}/* ${serverDir}/ && rm -rf ${overridesDir}`);
    }
    
    // Configurações específicas do loader
    await configureLoader(serverDir, version);
    
    // Restaura mundo se existir backup
    if (await directoryExists(worldBackup)) {
      await execAsync(`rm -rf ${path.join(serverDir, 'world')} && mv ${worldBackup} ${path.join(serverDir, 'world')}`);
    }
    
    log.push(`[${new Date().toISOString()}] Instalação concluída com sucesso!`);
    
    // Atualiza status
    const record = await prisma.serverModpack.findFirst({
      where: { server_id: serverIdNum }
    });
    if (record) {
      await prisma.serverModpack.update({
        where: { id: record.id },
        data: {
          status: 'installed',
          install_log: log.join('\n'),
          updated_at: new Date()
        }
      });
    }
    
  } catch (error) {
    log.push(`[${new Date().toISOString()}] ERRO: ${error}`);
    
    const record = await prisma.serverModpack.findFirst({
      where: { server_id: serverIdNum }
    });
    if (record) {
      await prisma.serverModpack.update({
        where: { id: record.id },
        data: {
          status: 'error',
          install_log: log.join('\n'),
          updated_at: new Date()
        }
      });
    }
  }
}

export async function uninstallModpack(serverId: string): Promise<void> {
  await prisma.serverModpack.deleteMany({
    where: { server_id: BigInt(serverId) }
  });
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  
  const buffer = await response.arrayBuffer();
  await fs.writeFile(dest, Buffer.from(buffer));
}

async function cleanServerDirectory(serverDir: string): Promise<void> {
  const keepFiles = ['world', 'server.properties', 'ops.json', 'whitelist.json', 'banned-players.json'];
  
  const entries = await fs.readdir(serverDir);
  
  for (const entry of entries) {
    if (!keepFiles.includes(entry)) {
      await fs.rm(path.join(serverDir, entry), { recursive: true, force: true });
    }
  }
}

async function configureLoader(serverDir: string, version: any): Promise<void> {
  // Configurações específicas para cada tipo de loader
  switch (version.loader) {
    case 'Forge':
      await configureForge(serverDir, version);
      break;
    case 'Fabric':
      await configureFabric(serverDir, version);
      break;
    case 'NeoForge':
      await configureNeoForge(serverDir, version);
      break;
  }
}

async function configureForge(serverDir: string, version: any): Promise<void> {
  // Configurações específicas do Forge
  const forgeInstaller = `forge-${version.minecraftVersion}-${version.loaderVersion}-installer.jar`;
  // Executa instalador do Forge se necessário
}

async function configureFabric(serverDir: string, version: any): Promise<void> {
  // Configurações específicas do Fabric
}

async function configureNeoForge(serverDir: string, version: any): Promise<void> {
  // Configurações específicas do NeoForge
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
