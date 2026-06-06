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
    
    // Backup do mundo ANTES de limpar
    const worldBackup = path.join(serverDir, 'world_backup');
    const worldDir = path.join(serverDir, 'world');
    if (await directoryExists(worldDir)) {
      log.push(`[${new Date().toISOString()}] Fazendo backup do mundo...`);
      await execAsync(`rm -rf ${worldBackup} && cp -r ${worldDir} ${worldBackup}`).catch((e: any) => {
        log.push(`[${new Date().toISOString()}] AVISO: Falha no backup do mundo: ${e?.message || e}`);
      });
    }
    
    // Limpa arquivos antigos (antes de baixar)
    log.push(`[${new Date().toISOString()}] Limpando instalação anterior...`);
    await cleanServerDirectory(serverDir);
    
    // Download do modpack
    log.push(`[${new Date().toISOString()}] Baixando modpack...`);
    log.push(`[${new Date().toISOString()}] URL: ${version.download_url || 'VAZIA'}`);
    const downloadPath = path.join(serverDir, 'modpack.zip');
    
    if (!version.download_url) {
      log.push(`[${new Date().toISOString()}] ERRO: URL de download vazia!`);
      throw new Error('URL de download não disponível');
    }
    
    await downloadFile(version.download_url, downloadPath);
    
    // Verifica se o arquivo foi baixado
    const stats = await fs.stat(downloadPath).catch(() => null);
    if (!stats || stats.size === 0) {
      log.push(`[${new Date().toISOString()}] ERRO: Arquivo baixado está vazio!`);
      throw new Error('Arquivo de modpack vazio');
    }
    log.push(`[${new Date().toISOString()}] Download concluído: ${stats.size} bytes`);
    
    // Extrai modpack
    log.push(`[${new Date().toISOString()}] Extraindo arquivos...`);
    await execAsync(`cd ${serverDir} && unzip -o modpack.zip && rm modpack.zip`);
    
    // Move arquivos do server pack se existir
    const overridesDir = path.join(serverDir, 'overrides');
    if (await directoryExists(overridesDir)) {
      await execAsync(`cp -r ${overridesDir}/* ${serverDir}/ && rm -rf ${overridesDir}`);
    }
    
    // Instala NeoForge se houver instalador (CurseForge Server Pack)
    const neoForgeInstaller = (await fs.readdir(serverDir)).find(f => f.startsWith('neoforge-') && f.endsWith('-installer.jar'));
    if (neoForgeInstaller) {
      log.push(`[${new Date().toISOString()}] Instalando NeoForge (${neoForgeInstaller})...`);
      try {
        await execAsync(`cd ${serverDir} && java -jar ${neoForgeInstaller} -installServer`);
        log.push(`[${new Date().toISOString()}] NeoForge instalado com sucesso`);
      } catch (e: any) {
        log.push(`[${new Date().toISOString()}] AVISO: Falha ao instalar NeoForge: ${e?.message || e}`);
      }
    }
    
    // Se tiver manifest.json (CurseForge), baixa mods individualmente
    const manifestPath = path.join(serverDir, 'manifest.json');
    const modsDir = path.join(serverDir, 'mods');
    if (await fileExists(manifestPath) && !await directoryExists(modsDir)) {
      log.push(`[${new Date().toISOString()}] Detectado manifest.json, baixando mods...`);
      try {
        const manifestContent = await fs.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestContent);
        if (manifest.files && Array.isArray(manifest.files)) {
          await fs.mkdir(modsDir, { recursive: true });
          const cfKey = await getCurseForgeKey();
          for (const modInfo of manifest.files) {
            try {
              if (modInfo.projectID && modInfo.fileID) {
                // Busca URL de download do mod via API CurseForge
                let modDownloadUrl = '';
                let modFileName = `${modInfo.projectID}_${modInfo.fileID}.jar`;
                if (cfKey) {
                  try {
                    // Busca dados do arquivo para obter nome correto e URL
                    log.push(`[${new Date().toISOString()}] [CurseForge] Buscando mod ${modInfo.projectID}/${modInfo.fileID}...`);
                    const fileDataRes = await fetch(`https://api.curseforge.com/v1/mods/${modInfo.projectID}/files/${modInfo.fileID}`, {
                      headers: { 'x-api-key': cfKey }
                    });
                    log.push(`[${new Date().toISOString()}] [CurseForge] API status: ${fileDataRes.status}`);
                    if (fileDataRes.ok) {
                      const fileData = await fileDataRes.json() as any;
                      const fileInfo = fileData.data;
                      modFileName = fileInfo.fileName || modFileName;
                      log.push(`[${new Date().toISOString()}] [CurseForge] fileName: ${fileInfo.fileName || 'N/A'}, downloadUrl: ${fileInfo.downloadUrl ? 'SIM' : 'N/A'}`);
                      if (fileInfo.downloadUrl) {
                        modDownloadUrl = fileInfo.downloadUrl;
                      }
                    }
                    // Se não tem downloadUrl, tenta endpoint /download
                    if (!modDownloadUrl) {
                      log.push(`[${new Date().toISOString()}] [CurseForge] Tentando endpoint /download...`);
                      const modDownloadRes = await fetch(`https://api.curseforge.com/v1/mods/${modInfo.projectID}/files/${modInfo.fileID}/download`, {
                        headers: { 'x-api-key': cfKey }
                      });
                      log.push(`[${new Date().toISOString()}] [CurseForge] /download status: ${modDownloadRes.status}`);
                      if (modDownloadRes.ok) {
                        const modDownloadData = await modDownloadRes.json() as any;
                        modDownloadUrl = modDownloadData.data?.url || '';
                        log.push(`[${new Date().toISOString()}] [CurseForge] /download url: ${modDownloadUrl ? 'SIM' : 'VAZIO'}`);
                      }
                    }
                  } catch (e) {
                    log.push(`[${new Date().toISOString()}] [CurseForge] Erro na API: ${e}`);
                  }
                }
                // Fallback manual com nome correto do arquivo
                if (!modDownloadUrl) {
                  const idStr = String(modInfo.fileID);
                  const part1 = idStr.substring(0, idStr.length - 3) || '0';
                  const part2 = idStr.substring(idStr.length - 3).padStart(3, '0');
                  modDownloadUrl = `https://edge.forgecdn.net/files/${part1}/${part2}/${modFileName}`;
                }
                if (modDownloadUrl) {
                  const modDest = path.join(modsDir, modFileName);
                  await downloadFile(modDownloadUrl, modDest);
                }
              }
            } catch (modErr: any) {
              log.push(`[${new Date().toISOString()}] AVISO: Falha ao baixar mod ${modInfo.projectID}/${modInfo.fileID}: ${modErr.message}`);
            }
          }
          log.push(`[${new Date().toISOString()}] Mods baixados: ${manifest.files.length}`);
        }
      } catch (e: any) {
        log.push(`[${new Date().toISOString()}] AVISO: Falha ao processar manifest.json: ${e.message}`);
      }
    }
    
    // Configurações específicas do loader (usa modloader do modpack)
    const loaderType = version.modpack?.modloader || version.loader || 'Forge';
    log.push(`[${new Date().toISOString()}] Configurando loader: ${loaderType}...`);
    await configureLoader(serverDir, { ...version, loader: loaderType });
    
    // Corrige permissões para o usuário pterodactyl (UID 999 no container Docker)
    log.push(`[${new Date().toISOString()}] Corrigindo permissoes...`);
    try {
      // Tenta chown para pterodactyl (pode falhar se user não existir no host)
      await execAsync(`chown -R 999:999 ${serverDir} 2>/dev/null || chown -R pterodactyl:pterodactyl ${serverDir} 2>/dev/null || true`);
      // Garante acesso total para o container ler os arquivos
      await execAsync(`chmod -R 777 ${serverDir}`);
      log.push(`[${new Date().toISOString()}] Permissoes corrigidas com sucesso`);
    } catch (e: any) {
      log.push(`[${new Date().toISOString()}] AVISO: Falha ao corrigir permissoes: ${e?.message || e}`);
    }
    
    // Verifica se server.jar existe - ESSENCIAL para iniciar
    const serverJarPath = path.join(serverDir, 'server.jar');
    if (!await directoryExists(serverJarPath)) {
      log.push(`[${new Date().toISOString()}] AVISO: server.jar não encontrado após configuração!`);
      // Tenta baixar server.jar vanilla como último recurso
      try {
        const mcVersion = version.minecraftVersion || '1.20.1';
        log.push(`[${new Date().toISOString()}] Tentando download fallback do server.jar (MC ${mcVersion})...`);
        // Busca URL correta do server.jar na API do Mojang
        const manifestRes = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json');
        const manifest = await manifestRes.json() as any;
        const versionInfo = manifest.versions.find((v: any) => v.id === mcVersion);
        if (!versionInfo) {
          throw new Error(`Versão ${mcVersion} não encontrada no manifesto Mojang`);
        }
        const versionJsonRes = await fetch(versionInfo.url);
        const versionJson = await versionJsonRes.json() as any;
        const serverUrl = versionJson.downloads?.server?.url;
        if (!serverUrl) {
          throw new Error('URL do server.jar não disponível no manifesto');
        }
        await downloadFile(serverUrl, serverJarPath);
        log.push(`[${new Date().toISOString()}] server.jar fallback baixado: ${mcVersion}`);
      } catch (e: any) {
        log.push(`[${new Date().toISOString()}] ERRO CRÍTICO: Não foi possível obter server.jar: ${e?.message || e}`);
        throw new Error('server.jar não encontrado após instalação');
      }
    } else {
      log.push(`[${new Date().toISOString()}] server.jar verificado com sucesso`);
    }
    
    // Restaura mundo se existir backup
    if (await directoryExists(worldBackup)) {
      log.push(`[${new Date().toISOString()}] Restaurando mundo...`);
      await execAsync(`rm -rf ${worldDir} && mv ${worldBackup} ${worldDir}`).catch((e: any) => {
        log.push(`[${new Date().toISOString()}] AVISO: Falha ao restaurar mundo: ${e?.message || e}`);
      });
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
  
  // Detecta versão do Minecraft do modrinth.index.json
  let mcVersion = version.minecraftVersion || '1.20.1';
  let fabricLoaderVersion = '0.15.7';
  
  try {
    const indexPath = path.join(serverDir, 'modrinth.index.json');
    if (await directoryExists(indexPath)) {
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(indexContent);
      // Extrai versão do Minecraft das dependências
      const gameVersion = index.dependencies?.minecraft;
      if (gameVersion) {
        mcVersion = gameVersion;
        console.log(`[Fabric] Minecraft version detectada: ${mcVersion}`);
      }
      // Extrai versão do Fabric Loader
      const loaderDep = index.dependencies?.['fabric-loader'];
      if (loaderDep) {
        fabricLoaderVersion = loaderDep;
        console.log(`[Fabric] Fabric Loader version detectada: ${fabricLoaderVersion}`);
      }
    }
  } catch (e) {
    console.warn('[Fabric] Falha ao ler modrinth.index.json:', e);
  }

  // Baixa Fabric installer e cria server.jar
  const fabricInstallerUrl = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${fabricLoaderVersion}/0.11.2/server/jar`;
  const serverJarPath = path.join(serverDir, 'server.jar');
  
  console.log(`[Fabric] Download server.jar: ${fabricInstallerUrl}`);
  try {
    await downloadFile(fabricInstallerUrl, serverJarPath);
    console.log('[Fabric] server.jar baixado com sucesso');
  } catch (e: any) {
    console.error('[Fabric] Falha ao baixar server.jar:', e?.message || e);
    // Fallback: tenta versão genérica
    try {
      const fallbackUrl = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/0.15.7/0.11.2/server/jar`;
      console.log(`[Fabric] Tentando fallback: ${fallbackUrl}`);
      await downloadFile(fallbackUrl, serverJarPath);
    } catch (e2) {
      console.error('[Fabric] Fallback também falhou');
    }
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
  const apiKey = await getPanelApiKey();
  if (!apiKey) {
    console.warn('[AutoStart] API Key do painel não configurada. Configure em Admin > Modpack Settings.');
    return;
  }

  try {
    // Usa a API do Pterodactyl para iniciar o servidor
    const response = await fetch(`https://host.foxy-mc.com/api/client/servers/${serverId}/power`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ signal: 'start' })
    });

    if (response.ok) {
      console.log(`[AutoStart] Comando de start enviado para o servidor ${serverId}`);
    } else {
      const errorData = await response.text();
      console.error(`[AutoStart] API retornou ${response.status}: ${errorData}`);
    }
  } catch (e: any) {
    console.error('[AutoStart] Falha ao iniciar servidor:', e?.message || String(e));
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

async function fileExists(path: string): Promise<boolean> {
  try {
    const stats = await fs.stat(path);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function getCurseForgeKey(): Promise<string | null> {
  try {
    const result: any = await prisma.$queryRaw`SELECT value FROM modpack_settings WHERE \`key\` = 'curseforge_api_key' LIMIT 1`;
    return result?.[0]?.value || null;
  } catch {
    return null;
  }
}
