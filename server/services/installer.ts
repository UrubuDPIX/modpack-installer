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

  // Converte IDs de forma segura
  const modpackIdNum = !isNaN(Number(modpackId)) ? BigInt(modpackId) : BigInt(0);
  const versionIdNum = !isNaN(Number(versionId)) ? BigInt(versionId) : BigInt(0);

  // Limpa instalação anterior
  await prisma.serverModpack.deleteMany({
    where: { server_id: serverId }
  });

  // Cria novo registro
  const serverModpack = await prisma.serverModpack.create({
    data: {
      server_id: serverId,
      modpack_id: modpackIdNum,
      modpack_version_id: versionIdNum,
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
  
  try {
    log.push(`[${new Date().toISOString()}] Iniciando instalação: ${version.modpack.name} ${version.version}`);
    
    // Diretório do servidor (exemplo - ajustar conforme estrutura Jexactyl)
    const serverDir = `/var/lib/pterodactyl/volumes/${serverId}`;
    
    // Cria diretório se não existir
    await fs.mkdir(serverDir, { recursive: true });
    
    // Limpa arquivos antigos (antes de baixar)
    log.push(`[${new Date().toISOString()}] Limpando instalação anterior...`);
    await cleanServerDirectory(serverDir);
    
    // Download do modpack
    log.push(`[${new Date().toISOString()}] Baixando modpack...`);
    const downloadPath = path.join(serverDir, 'modpack.zip');
    await downloadFile(version.download_url, downloadPath);
    log.push(`[${new Date().toISOString()}] Download concluído: ${version.file_size}`);
    
    // Backup se necessário
    const worldBackup = path.join(serverDir, 'world_backup');
    await execAsync(`cp -r ${path.join(serverDir, 'world')} ${worldBackup}`).catch(() => {});
    
    // Extrai modpack
    log.push(`[${new Date().toISOString()}] Extraindo arquivos...`);
    await execAsync(`cd ${serverDir} && unzip -o modpack.zip && rm modpack.zip`);
    
    // Corrige permissões para o usuário pterodactyl
    log.push(`[${new Date().toISOString()}] Corrigindo permissoes...`);
    await execAsync(`chown -R pterodactyl:pterodactyl ${serverDir}`);
    
    // Move arquivos do server pack se existir
    const overridesDir = path.join(serverDir, 'overrides');
    if (await directoryExists(overridesDir)) {
      await execAsync(`cp -r ${overridesDir}/* ${serverDir}/ && rm -rf ${overridesDir}`);
    }
    
    // Configurações específicas do loader (usa modloader do modpack)
    const loaderType = version.modpack?.modloader || version.loader || 'Forge';
    await configureLoader(serverDir, { ...version, loader: loaderType });
    
    // Restaura mundo se existir backup
    if (await directoryExists(worldBackup)) {
      await execAsync(`rm -rf ${path.join(serverDir, 'world')} && mv ${worldBackup} ${path.join(serverDir, 'world')}`);
    }
    
    log.push(`[${new Date().toISOString()}] Instalação concluída com sucesso!`);
    
    // Atualiza status
    const record = await prisma.serverModpack.findFirst({
      where: { server_id: serverId }
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
    
    // Inicia servidor automaticamente
    log.push(`[${new Date().toISOString()}] Iniciando servidor...`);
    try {
      await startServer(serverId);
      log.push(`[${new Date().toISOString()}] Servidor iniciado com sucesso!`);
    } catch (e: any) {
      log.push(`[${new Date().toISOString()}] AVISO: Falha ao iniciar servidor: ${e?.message || String(e)}`);
    }
    
  } catch (error) {
    log.push(`[${new Date().toISOString()}] ERRO: ${error}`);
    
    const record = await prisma.serverModpack.findFirst({
      where: { server_id: serverId }
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
    where: { server_id: serverId }
  });
}

async function downloadFile(url: string, dest: string): Promise<void> {
  console.log(`[Download] URL: ${url}`);
  const response = await fetch(url);
  console.log(`[Download] Status: ${response.status}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  
  const buffer = await response.arrayBuffer();
  console.log(`[Download] Tamanho: ${buffer.byteLength} bytes`);
  await fs.writeFile(dest, Buffer.from(buffer));
  
  // Verifica se arquivo foi salvo
  const stats = await fs.stat(dest);
  console.log(`[Download] Arquivo salvo: ${dest} (${stats.size} bytes)`);
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
  // Lê modrinth.index.json e baixa os mods
  const indexPath = path.join(serverDir, 'modrinth.index.json');
  if (await directoryExists(indexPath)) {
    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(indexContent);
    
    // Baixa cada arquivo listado no index
    for (const file of index.files || []) {
      if (file.downloads && file.downloads.length > 0) {
        const filePath = path.join(serverDir, file.path);
        const fileDir = path.dirname(filePath);
        await fs.mkdir(fileDir, { recursive: true });
        
        try {
          await downloadFile(file.downloads[0], filePath);
        } catch (e) {
          console.error(`[Fabric] Falha ao baixar ${file.path}:`, e);
        }
      }
    }
  }
  
  // Cria eula.txt
  const eulaPath = path.join(serverDir, 'eula.txt');
  if (!await directoryExists(eulaPath)) {
    await fs.writeFile(eulaPath, 'eula=true\n');
  }
  
  // Baixa Fabric installer e cria server.jar
  const mcVersion = version.minecraftVersion || '1.20.1';
  const fabricInstallerUrl = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/0.15.7/0.11.2/server/jar`;
  const serverJarPath = path.join(serverDir, 'server.jar');
  
  try {
    await downloadFile(fabricInstallerUrl, serverJarPath);
  } catch (e) {
    console.error('[Fabric] Falha ao baixar server.jar:', e);
  }
}

async function configureNeoForge(serverDir: string, version: any): Promise<void> {
  // Configurações específicas do NeoForge
}

async function getPanelApiKey(): Promise<string | null> {
  try {
    const result: any = await prisma.$queryRaw`SELECT value FROM modpack_settings WHERE \`key\` = 'panel_api_key' LIMIT 1`;
    return result?.[0]?.value || null;
  } catch {
    return null;
  }
}

async function startServer(serverId: string): Promise<void> {
  const panelKey = await getPanelApiKey();
  if (!panelKey) {
    console.log('[AutoStart] API key do painel nao configurada');
    return;
  }

  const panelUrl = process.env.PANEL_URL || 'https://host.foxy-mc.com';
  
  const response = await fetch(`${panelUrl}/api/client/servers/${serverId}/power`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${panelKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ signal: 'start' })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
