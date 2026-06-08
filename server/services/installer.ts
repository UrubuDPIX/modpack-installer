import { prisma } from '../index';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import https from 'https';
import http from 'http';
import { createWriteStream } from 'fs';

const execAsync = promisify(exec);

// Categorias do CurseForge que indicam mods client-side (não devem ir pro servidor)
const CF_CLIENT_SIDE_CATEGORIES = [
  422, // Mapas e Minimaps (JourneyMap, Xaero's)
  421, // Customização de Chat
  424, // UI e HUD
  4642, // Otimizações Gráficas (Sodium, Iris)
  4555, // Shaders
  4455, // Resource Packs
];

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
  const originalPush = log.push;
  log.push = function(...args: string[]) {
    for (const arg of args) {
      console.log(arg);
    }
    return originalPush.apply(log, args);
  };

  // Encontra o registro no banco para atualizar log periodicamente
  const serverModpack = await prisma.serverModpack.findFirst({
    where: { server_id: serverId }
  });

  // Flush periódico do log a cada 5 segundos
  const flushInterval = setInterval(async () => {
    if (serverModpack && log.length > 0) {
      try {
        await prisma.serverModpack.update({
          where: { id: serverModpack.id },
          data: {
            install_log: getTruncatedLog(log),
            updated_at: new Date()
          }
        });
      } catch (e) {
        // Silencia erros de flush periódico
      }
    }
  }, 5000);
  
  // Diretório do servidor (exemplo - ajustar conforme estrutura Jexactyl)
  const serverDir = `/var/lib/pterodactyl/volumes/${serverId}`;
  
  try {
    log.push(`[${new Date().toISOString()}] Iniciando instalação: ${version.modpack.name} ${version.version}`);
    
    // Cria diretório se não existir
    await fs.mkdir(serverDir, { recursive: true });
    
    // Limpa diretório do servidor (remove arquivos de instalações anteriores)
    log.push(`[${new Date().toISOString()}] Limpando diretório do servidor...`);
    try {
      await cleanServerDir(serverDir);
      log.push(`[${new Date().toISOString()}] Diretório limpo com sucesso`);
    } catch (e: any) {
      log.push(`[${new Date().toISOString()}] AVISO: Falha ao limpar diretório: ${e?.message || e}`);
    }
    
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
    
    try {
      await downloadFile(version.download_url, downloadPath);
    } catch (downloadErr: any) {
      log.push(`[${new Date().toISOString()}] ERRO: Falha no download do modpack: ${downloadErr.message}`);
      throw new Error(`Falha ao baixar modpack: ${downloadErr.message}`);
    }
    
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
    
    // Se o ZIP extraiu tudo para uma única subpasta (ex: StoneBlock-1.0.36/), move para raiz
    const extractedEntries = await fs.readdir(serverDir);
    const topLevelDirs = [];
    for (const entry of extractedEntries) {
      const entryPath = path.join(serverDir, entry);
      const stat = await fs.stat(entryPath).catch(() => null);
      if (stat?.isDirectory() && entry !== 'world' && entry !== 'world_backup') {
        topLevelDirs.push(entry);
      }
    }
    if (topLevelDirs.length === 1) {
      const singleDir = topLevelDirs[0];
      log.push(`[${new Date().toISOString()}] Movendo arquivos de ${singleDir}/ para raiz...`);
      await execAsync(`cd ${serverDir} && cp -r ${singleDir}/* . && rm -rf ${singleDir}`);
    }
    
    // Move arquivos do server pack se existir
    const overridesDir = path.join(serverDir, 'overrides');
    if (await directoryExists(overridesDir)) {
      await execAsync(`cp -r ${overridesDir}/* ${serverDir}/ && rm -rf ${overridesDir}`);
    }
    
    // Detecta se é um Server Pack (já vem com mods, configs e instalador)
    const hasModsDir = await directoryExists(path.join(serverDir, 'mods'));
    const hasConfigDir = await directoryExists(path.join(serverDir, 'config'));
    const hasForgeInstaller = (await fs.readdir(serverDir).catch(() => [])).some((f: string) => f.startsWith('forge-') && f.endsWith('-installer.jar'));
    const hasNeoForgeInstaller = (await fs.readdir(serverDir).catch(() => [])).some((f: string) => f.startsWith('neoforge-') && f.endsWith('-installer.jar'));
    const isServerPack = hasModsDir && (hasForgeInstaller || hasNeoForgeInstaller);
    
    // Pré-instala Forge/NeoForge no backend com Docker (tem internet) - SEMPRE que houver installer
    const javaImage = getJavaImageForVersion(await detectMinecraftVersion(serverDir, version));
    if (hasForgeInstaller) {
      const installerJar = (await fs.readdir(serverDir)).find((f: string) => f.startsWith('forge-') && f.endsWith('-installer.jar'));
      if (installerJar) {
        const serverJar = installerJar.replace('-installer.jar', '.jar');
        if (!await fileExists(path.join(serverDir, serverJar)) || !await directoryExists(path.join(serverDir, 'libraries'))) {
          log.push(`[${new Date().toISOString()}] Pre-instalando Forge com Docker...`);
          try {
            await execAsync(`docker run --rm --user root -v ${serverDir}:/data -w /data ${javaImage} java -jar ${installerJar} --installServer`);
            log.push(`[${new Date().toISOString()}] Forge pre-instalado com sucesso`);
          } catch (e: any) {
            log.push(`[${new Date().toISOString()}] AVISO: Pre-instalação falhou: ${e?.message || e}`);
          }
        } else {
          log.push(`[${new Date().toISOString()}] Forge já está instalado`);
        }
      }
    }
    if (hasNeoForgeInstaller) {
      const installerJar = (await fs.readdir(serverDir)).find((f: string) => f.startsWith('neoforge-') && f.endsWith('-installer.jar'));
      if (installerJar) {
        if (!await directoryExists(path.join(serverDir, 'libraries'))) {
          log.push(`[${new Date().toISOString()}] Pre-instalando NeoForge com Docker...`);
          try {
            await execAsync(`docker run --rm --user root -v ${serverDir}:/data -w /data ${javaImage} java -jar ${installerJar} --installServer`);
            log.push(`[${new Date().toISOString()}] NeoForge pre-instalado com sucesso`);
          } catch (e: any) {
            log.push(`[${new Date().toISOString()}] AVISO: Pre-instalação falhou: ${e?.message || e}`);
          }
        }
      }
    }

    if (isServerPack) {
      log.push(`[${new Date().toISOString()}] Server Pack detectado! Pulando download de mods individuais.`);
    } else {
      // Baixa mods do modrinth.index.json (funciona para QUALQUER modloader)
      log.push(`[${new Date().toISOString()}] Verificando modrinth.index.json...`);
      await downloadModrinthMods(serverDir);
    }
    
    // Auto-detecta o modloader (Forge, NeoForge, Fabric) do modpack
    const detected = await autoDetectModloader(serverDir, version, log);
    
    // Atualiza os metadados dinamicamente para as etapas seguintes do instalador
    version.loader = detected.loader;
    if (detected.loaderVersion) {
      version.loaderVersion = detected.loaderVersion;
    }
    if (detected.minecraftVersion) {
      version.minecraftVersion = detected.minecraftVersion;
    }

    // Se há um instalador local pré-baixado (Server Pack), executa-o com prioridade máxima
    const localNeoForgeInstaller = (await fs.readdir(serverDir)).find((f: string) => f.startsWith('neoforge-') && f.endsWith('-installer.jar'));
    const localForgeInstaller = (await fs.readdir(serverDir)).find((f: string) => f.startsWith('forge-') && f.endsWith('-installer.jar'));

    if (localNeoForgeInstaller) {
      log.push(`[${new Date().toISOString()}] Executando instalador local do NeoForge (${localNeoForgeInstaller}) via Docker...`);
      try {
        const javaImage = getJavaImageForVersion(detected.minecraftVersion);
        await runCommandWithLog(`docker run --rm --user root -v ${serverDir}:/data -w /data ${javaImage} java -jar ${localNeoForgeInstaller} -installServer`, log);
        log.push(`[${new Date().toISOString()}] NeoForge local instalado com sucesso`);
      } catch (e: any) {
        log.push(`[${new Date().toISOString()}] AVISO: Falha ao instalar NeoForge local: ${e?.message || e}`);
      }
    } else if (localForgeInstaller) {
      log.push(`[${new Date().toISOString()}] Executando instalador local do Forge (${localForgeInstaller}) via Docker...`);
      try {
        const javaImage = getJavaImageForVersion(detected.minecraftVersion);
        await runCommandWithLog(`docker run --rm --user root -v ${serverDir}:/data -w /data ${javaImage} java -jar ${localForgeInstaller} -installServer`, log);
        log.push(`[${new Date().toISOString()}] Forge local instalado com sucesso`);
      } catch (e: any) {
        log.push(`[${new Date().toISOString()}] AVISO: Falha ao instalar Forge local: ${e?.message || e}`);
      }
    } else {
      // Se não há instaladores locais, usa nossa auto-detecção para baixar e instalar remotamente!
      const librariesPath = path.join(serverDir, 'libraries');
      const hasLibraries = await directoryExists(librariesPath) && (await fs.readdir(librariesPath).catch(() => [])).length > 0;

      if (detected.loader === 'NeoForge') {
        const hasNeoForgeJar = (await fs.readdir(serverDir)).some((f: string) => f.startsWith('neoforge-') && !f.includes('-installer'));
        if (!hasNeoForgeJar || !hasLibraries) {
          log.push(`[${new Date().toISOString()}] NeoForge detectado mas incompleto (jar ou libraries faltando), iniciando instalação...`);
          await installNeoForge(serverDir, detected.minecraftVersion, log, detected.loaderVersion);
        }
      } else if (detected.loader === 'Forge') {
        const hasForgeJar = (await fs.readdir(serverDir)).some((f: string) => /^forge-.+\.jar$/.test(f) && !f.includes('-installer'));
        if (!hasForgeJar || !hasLibraries) {
          log.push(`[${new Date().toISOString()}] Forge detectado mas incompleto (jar ou libraries faltando), iniciando instalação...`);
          await installForge(serverDir, detected.minecraftVersion, log, detected.loaderVersion);
        }
      } else if (detected.loader === 'Fabric') {
        const hasFabricJar = await fileExists(path.join(serverDir, 'server.jar'));
        if (!hasFabricJar) {
          log.push(`[${new Date().toISOString()}] Fabric detectado mas server.jar não encontrado, baixando Fabric server jar...`);
        } else {
          log.push(`[${new Date().toISOString()}] Fabric detectado, verificando mods e configurações...`);
        }
        await configureFabric(serverDir, { ...version, minecraftVersion: detected.minecraftVersion, loaderVersion: detected.loaderVersion });
      }
    }
    
    // Se tiver manifest.json (CurseForge), baixa mods individualmente
    const manifestPath = path.join(serverDir, 'manifest.json');
    const modsDir = path.join(serverDir, 'mods');
    if (await fileExists(manifestPath)) {
      log.push(`[${new Date().toISOString()}] Detectado manifest.json, processando downloads de mods...`);
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
                    // Busca dados do MOD para verificar se é client-side (categorias)
                    log.push(`[${new Date().toISOString()}] [CurseForge] Verificando mod ${modInfo.projectID}...`);
                    const modMetaRes = await fetch(`https://api.curseforge.com/v1/mods/${modInfo.projectID}`, {
                      headers: { 'x-api-key': cfKey }
                    });
                    
                    if (modMetaRes.ok) {
                      const modMeta = await modMetaRes.json() as any;
                      const modDetails = modMeta.data;
                      
                      // Verifica se o mod pertence a categorias client-side
                      const isClientSide = modDetails.categories?.some((cat: any) => 
                        CF_CLIENT_SIDE_CATEGORIES.includes(cat.id)
                      );
                      
                      if (isClientSide) {
                        log.push(`[${new Date().toISOString()}] [CurseForge] IGNORADO (Client-Side): ${modDetails.name}`);
                        continue; // Pula o download deste mod
                      }
                    }
                    
                    // Busca dados do ARQUIVO para obter nome correto e URL
                    log.push(`[${new Date().toISOString()}] [CurseForge] Buscando arquivo ${modInfo.projectID}/${modInfo.fileID}...`);
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
    
    // Remove mods client-side que podem causar crashes no servidor
    log.push(`[${new Date().toISOString()}] Removendo mods client-side...`);
    await removeClientSideMods(modsDir, log);
    
    // Loader já configurado anteriormente no fluxo (installForge/installNeoForge/configureFabric)
    // Não chama configureLoader aqui para evitar duplicação de instalação
    
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
    
    // Verifica se o modpack já tem conteúdo de servidor (Server Pack)
    const hasStartupScript = (await fs.readdir(serverDir)).some((f: string) => 
      f === 'startserver.sh' || f === 'run.sh' || f === 'run.bat'
    );
    const hasForgeUniversal = (await fs.readdir(serverDir)).some((f: string) => 
      /^forge-.+-universal\.jar$/.test(f)
    );
    const isServerPackComplete = isServerPack || hasStartupScript || hasForgeUniversal;
    
    if (isServerPackComplete) {
      log.push(`[${new Date().toISOString()}] Server Pack detectado (mods=${hasModsDir}, config=${hasConfigDir}, script=${hasStartupScript}, forge=${hasForgeUniversal}, neoforge=${hasNeoForgeInstaller})`);
      log.push(`[${new Date().toISOString()}] Pulando download de server.jar vanilla`);
    }
    
    // Verifica se server.jar existe - ESSENCIAL para iniciar
    const serverJarPath = path.join(serverDir, 'server.jar');
    if (!isServerPackComplete && !await fileExists(serverJarPath)) {
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
    } else if (!isServerPack) {
      log.push(`[${new Date().toISOString()}] server.jar verificado com sucesso`);
    }
    
    // Aceita EULA automaticamente
    const eulaPath = path.join(serverDir, 'eula.txt');
    try {
      await fs.writeFile(eulaPath, 'eula=true\n');
      log.push(`[${new Date().toISOString()}] EULA aceita automaticamente`);
    } catch (e: any) {
      log.push(`[${new Date().toISOString()}] AVISO: Falha ao escrever eula.txt: ${e?.message || e}`);
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
          install_log: getTruncatedLog(log),
          updated_at: new Date()
        }
      });
    }
    
    // Instala NeoForge se houver startserver.sh (instala sem iniciar)
    const startScriptPath = path.join(serverDir, 'startserver.sh');
    if (await fileExists(startScriptPath)) {
      log.push(`[${new Date().toISOString()}] Instalando NeoForge via startserver.sh...`);
      try {
        await execAsync(`cd ${serverDir} && chmod +x startserver.sh && ATM10_INSTALL_ONLY=true ./startserver.sh`);
        log.push(`[${new Date().toISOString()}] NeoForge instalado com sucesso`);
      } catch (e: any) {
        log.push(`[${new Date().toISOString()}] AVISO: Falha ao instalar NeoForge: ${e?.message || e}`);
      }
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
          install_log: getTruncatedLog(log),
          updated_at: new Date()
        }
      });
    }
  } finally {
    clearInterval(flushInterval);
    // Detecta loader, pré-instala se necessário, e atualiza startup no painel
    try {
      const mcVersion = await detectMinecraftVersion(serverDir, version);
      await detectAndConfigureStartup(serverId, serverDir, mcVersion, version);
    } catch (e: any) {
      console.warn(`[Installer] Falha no detectAndConfigureStartup no finally: ${e?.message || e}`);
    }
  }
}

export async function uninstallModpack(serverId: string): Promise<void> {
  await prisma.serverModpack.deleteMany({
    where: { server_id: serverId }
  });
}

async function runCommandWithLog(command: string, log: string[]): Promise<void> {
  try {
    const { stdout, stderr } = await execAsync(command);
    if (stdout) {
      log.push(stdout.toString());
    }
    if (stderr) {
      log.push(`[STDERR] ${stderr.toString()}`);
    }
  } catch (error: any) {
    if (error.stdout) log.push(error.stdout.toString());
    if (error.stderr) log.push(`[STDERR] ${error.stderr.toString()}`);
    throw error;
  }
}

async function downloadFile(url: string, dest: string, redirectCount = 0): Promise<void> {
  if (redirectCount > 5) {
    throw new Error(`Muitos redirects ao baixar ${url}`);
  }
  console.log(`[Download] URL: ${url}`);
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const file = createWriteStream(dest);
    let downloaded = 0;
    let lastLog = 0;
    const startTime = Date.now();

    const request = client.get(url, { timeout: 600_000 }, (response: any) => {
      // Segue redirects (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const redirectUrl = response.headers.location;
        if (!redirectUrl) {
          file.close();
          reject(new Error(`HTTP ${response.statusCode} sem header Location`));
          return;
        }
        file.close();
        console.log(`[Download] Redirect ${response.statusCode} -> ${redirectUrl}`);
        downloadFile(redirectUrl, dest, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${response.statusCode} para ${url}`));
        return;
      }

      response.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (downloaded - lastLog >= 10 * 1024 * 1024) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[Download] ${(downloaded / 1024 / 1024).toFixed(1)} MB em ${elapsed}s`);
          lastLog = downloaded;
        }
      });

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`[Download] Concluído: ${dest} (${downloaded} bytes)`);
        resolve();
      });
    });

    request.on('error', (err: Error) => {
      file.close();
      fs.unlink(dest).catch(() => {});
      reject(err);
    });

    request.on('timeout', () => {
      request.destroy();
      file.close();
      fs.unlink(dest).catch(() => {});
      reject(new Error(`Timeout (10min) ao baixar ${url}`));
    });

    file.on('error', (err: Error) => {
      request.destroy();
      fs.unlink(dest).catch(() => {});
      reject(err);
    });
  });
}

async function cleanServerDirectory(serverDir: string): Promise<void> {
  // Remove TUDO exceto arquivos de preservação
  const preserve = ['.pteroignore', 'world_backup'];
  
  const entries = await fs.readdir(serverDir);
  
  for (const entry of entries) {
    if (preserve.includes(entry)) continue;
    
    const entryPath = path.join(serverDir, entry);
    try {
      await fs.rm(entryPath, { recursive: true, force: true });
    } catch (e) {
      // Ignora erros de permissão
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
      await configureNeoForge(serverDir, version, []);
      break;
  }
}

async function configureForge(serverDir: string, version: any): Promise<void> {
  // Configurações específicas do Forge
  const forgeInstaller = `forge-${version.minecraftVersion}-${version.loaderVersion}-installer.jar`;
  // Executa instalador do Forge se necessário
}

async function downloadModrinthMods(serverDir: string): Promise<void> {
  // Lê modrinth.index.json e baixa os mods
  const indexPath = path.join(serverDir, 'modrinth.index.json');
  if (await directoryExists(indexPath)) {
    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(indexContent);
    
    for (const file of index.files || []) {
      // Ignora mods client-side (env.server === 'unsupported')
      if (file.env?.server === 'unsupported') {
        console.log(`[Modrinth] IGNORADO (Client-Side): ${file.path}`);
        continue;
      }
      
      if (file.downloads && file.downloads.length > 0) {
        const filePath = path.join(serverDir, file.path);
        const fileDir = path.dirname(filePath);
        await fs.mkdir(fileDir, { recursive: true });
        
        try {
          await downloadFile(file.downloads[0], filePath);
        } catch (e) {
          console.error(`[Modrinth] Falha ao baixar ${file.path}:`, e);
        }
      }
    }
  }
}

async function configureFabric(serverDir: string, version: any): Promise<void> {
  // Baixa mods do modrinth.index.json se existir (chamado também no fluxo principal)
  await downloadModrinthMods(serverDir);
  
  // Cria eula.txt
  const eulaPath = path.join(serverDir, 'eula.txt');
  if (!await directoryExists(eulaPath)) {
    await fs.writeFile(eulaPath, 'eula=true\n');
  }
  
  // Detecta versão do Minecraft e dos modloaders
  let mcVersion = version.minecraftVersion || '1.20.1';
  let fabricLoaderVersion = '0.15.11'; // Fallback mais moderno
  let detectedForgeVersion = ''; // Versão do Forge detectada do manifest
  
  try {
    // 1. Tenta ler do manifest.json (CurseForge)
    const manifestPath = path.join(serverDir, 'manifest.json');
    if (await fileExists(manifestPath)) {
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);
      if (manifest.minecraft?.version) {
        mcVersion = manifest.minecraft.version;
        console.log(`[Fabric] Minecraft version detectada no manifest.json: ${mcVersion}`);
      }
      const loaders = manifest.minecraft?.modLoaders || [];
      const fabricLoader = loaders.find((l: any) => l.id && l.id.startsWith('fabric-'));
      if (fabricLoader) {
        fabricLoaderVersion = fabricLoader.id.replace('fabric-', '');
        console.log(`[Fabric] Fabric Loader version detectada no manifest.json: ${fabricLoaderVersion}`);
      }
      // Detecta versão do Forge do manifest
      const forgeLoader = loaders.find((l: any) => l.id && l.id.startsWith('forge-'));
      if (forgeLoader) {
        detectedForgeVersion = forgeLoader.id.replace('forge-', '');
        console.log(`[Forge] Forge version detectada no manifest.json: ${detectedForgeVersion}`);
      }
    }
    
    // 2. Tenta ler do modrinth.index.json como fallback
    const indexPath = path.join(serverDir, 'modrinth.index.json');
    if (await directoryExists(indexPath)) {
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(indexContent);
      // Extrai versão do Minecraft das dependências
      const gameVersion = index.dependencies?.minecraft;
      if (gameVersion) {
        mcVersion = gameVersion;
        console.log(`[Fabric] Minecraft version detectada no modrinth.index.json: ${mcVersion}`);
      }
      // Extrai versão do Fabric Loader
      const loaderDep = index.dependencies?.['fabric-loader'];
      if (loaderDep) {
        fabricLoaderVersion = loaderDep;
        console.log(`[Fabric] Fabric Loader version detectada no modrinth.index.json: ${fabricLoaderVersion}`);
      }
    }
  } catch (e) {
    console.warn('[Fabric] Falha ao ler manifest.json ou modrinth.index.json:', e);
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

async function configureNeoForge(serverDir: string, version: any, log: string[]): Promise<void> {
  // Detecta versão do Minecraft e do NeoForge
  let mcVersion = version.minecraftVersion || '1.21.1';
  let neoForgeVersion = version.loaderVersion || '';
  
  try {
    const manifestPath = path.join(serverDir, 'manifest.json');
    if (await fileExists(manifestPath)) {
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);
      if (manifest.minecraft?.version) {
        mcVersion = manifest.minecraft.version;
      }
      const loaders = manifest.minecraft?.modLoaders || [];
      const neoForgeLoader = loaders.find((l: any) => l.id && l.id.startsWith('neoforge-'));
      if (neoForgeLoader) {
        neoForgeVersion = neoForgeLoader.id.replace('neoforge-', '');
      }
    }
    
    const indexPath = path.join(serverDir, 'modrinth.index.json');
    if (await directoryExists(indexPath)) {
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(indexContent);
      if (index.dependencies?.minecraft) {
        mcVersion = index.dependencies.minecraft;
      }
      if (index.dependencies?.['neoforge']) {
        neoForgeVersion = index.dependencies['neoforge'];
      }
    }
  } catch (e) {
    // Ignora erros de leitura
  }
  
  if (!neoForgeVersion) {
    const neoForgeVersions: Record<string, string> = {
      '1.20.1': '20.2.59',
      '1.20.4': '20.4.237',
      '1.20.6': '20.6.119',
      '1.21.1': '21.1.143',
      '1.21.4': '21.4.47',
    };
    neoForgeVersion = neoForgeVersions[mcVersion] || '';
  }
  
  if (!neoForgeVersion) {
    log.push(`[${new Date().toISOString()}] AVISO: Versao ${mcVersion} nao mapeada para NeoForge. Abortando.`);
    throw new Error(`Versão do NeoForge não mapeada para Minecraft ${mcVersion}`);
  }
  
  const neoForgeInstaller = `neoforge-${neoForgeVersion}-installer.jar`;
  const installerPath = path.join(serverDir, neoForgeInstaller);
  
  const neoForgeInstallerExists = await fileExists(installerPath);
  if (neoForgeInstallerExists) {
    log.push(`[${new Date().toISOString()}] Instalador NeoForge já existe em ${installerPath}, pulando download`);
  } else {
    const neoForgeUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoForgeVersion}/${neoForgeInstaller}`;
    log.push(`[${new Date().toISOString()}] Baixando NeoForge ${neoForgeVersion}...`);
    try {
      await downloadFile(neoForgeUrl, installerPath);
    } catch (neoDownloadErr: any) {
      log.push(`[${new Date().toISOString()}] AVISO: Falha ao baixar NeoForge ${neoForgeVersion}: ${neoDownloadErr.message}`);
      throw new Error(`Não foi possível baixar o instalador do NeoForge ${neoForgeVersion}: ${neoDownloadErr.message}`);
    }
  }
  
  log.push(`[${new Date().toISOString()}] Instalando NeoForge...`);
  const javaImage = getJavaImageForVersion(mcVersion);
  await runCommandWithLog(`docker run --rm --user root -v ${serverDir}:/data -w /data ${javaImage} java -jar ${neoForgeInstaller} -installServer`, log);
  
  log.push(`[${new Date().toISOString()}] NeoForge instalado com sucesso`);
}

async function getPanelApiKey(): Promise<string | null> {
  try {
    const result: any = await prisma.$queryRaw`SELECT value FROM modpack_settings WHERE \`key\` = 'panel_api_key' LIMIT 1`;
    return result?.[0]?.value || null;
  } catch {
    return null;
  }
}

async function getServerInternalId(serverId: string): Promise<string | null> {
  const apiKey = await getPanelApiKey();
  if (!apiKey) return null;

  try {
    // Busca todos os servidores para encontrar o ID interno pelo UUID
    const response = await fetch('https://host.foxy-mc.com/api/application/servers', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json() as any;
      const servers = data.data || [];
      const server = servers.find((s: any) => s.attributes?.uuid === serverId || s.attributes?.identifier === serverId);
      if (server) {
        console.log(`[API] Servidor encontrado: ID interno=${server.attributes?.id}`);
        return String(server.attributes?.id);
      }
    }
  } catch (e) {
    console.error('[API] Falha ao buscar ID interno:', e);
  }
  return null;
}

async function startServer(serverId: string): Promise<void> {
  const apiKey = await getPanelApiKey();
  if (!apiKey) {
    console.warn('[AutoStart] API Key do painel não configurada. Configure em Admin > Modpack Settings.');
    return;
  }

  try {
    // Client API usa UUID
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

async function detectAndConfigureStartup(serverId: string, serverDir: string, mcVersion: string, version?: any): Promise<string | null> {
  let files = await fs.readdir(serverDir);
  let startupCommand: string | null = null;
  let detectedLoader = 'unknown';

  // --- ETAPA 0: Pré-instala Forge/NeoForge com Docker se necessário ---
  const installerJar = files.find((f: string) => (f.startsWith('forge-') || f.startsWith('neoforge-')) && f.endsWith('-installer.jar'));
  if (installerJar) {
    const serverJar = installerJar.replace('-installer.jar', '.jar');
    const librariesExist = await directoryExists(path.join(serverDir, 'libraries'));
    const jarExists = await fileExists(path.join(serverDir, serverJar));
    if (!librariesExist || !jarExists) {
      console.log(`[Detector] Pré-instalando ${installerJar} via Docker...`);
      try {
        const javaImage = getJavaImageForVersion(mcVersion);
        await execAsync(`docker run --rm --user root -v ${serverDir}:/data -w /data ${javaImage} java -jar ${installerJar} --installServer`);
        console.log(`[Detector] Forge instalado com sucesso`);
        // Re-escaneia arquivos após instalação
        files = await fs.readdir(serverDir);
      } catch (e: any) {
        console.error(`[Detector] ERRO na pré-instalação: ${e?.message || e}`);
      }
    }
  }

  // --- ETAPA 1: Detecta loader a partir dos dados do modpack ---
  let modpackType = 'unknown';
  if (version) {
    const loaderFromVer = (version.modpack?.modloader || version.loader || '').toLowerCase();
    if (loaderFromVer.includes('fabric')) modpackType = 'fabric';
    else if (loaderFromVer.includes('neoforge')) modpackType = 'neoforge';
    else if (loaderFromVer.includes('forge')) modpackType = 'forge';
    else if (loaderFromVer.includes('quilt')) modpackType = 'quilt';
    else if (loaderFromVer.includes('vanilla')) modpackType = 'vanilla';
    console.log(`[Detector] Loader from DB: ${modpackType}`);
  }

  // --- ETAPA 2: Detecta loader a partir dos arquivos no disco ---
  // NeoForge/Forge: startserver.sh
  if (files.includes('startserver.sh')) {
    console.log('[Detector] startserver.sh encontrado');
    detectedLoader = 'neoforge'; // ou forge, mas startserver.sh é tipicamente NeoForge
    startupCommand = 'bash startserver.sh';
  }
  // Forge: run.sh
  else if (files.includes('run.sh')) {
    console.log('[Detector] run.sh encontrado');
    detectedLoader = 'forge';
    startupCommand = 'bash run.sh';
  }
  // NeoForge: unix_args.txt
  else {
    const neoForgePattern = /libraries\/net\/neoforged\/neoforge\/([^/]+)\/unix_args\.txt/;
    const neoForgeMatch = files.find(f => neoForgePattern.test(f));
    if (neoForgeMatch) {
      const nfMatch = neoForgeMatch.match(neoForgePattern);
      if (nfMatch) {
        console.log(`[Detector] NeoForge unix_args.txt encontrado (v${nfMatch[1]})`);
        detectedLoader = 'neoforge';
        startupCommand = `java @user_jvm_args.txt @libraries/net/neoforged/neoforge/${nfMatch[1]}/unix_args.txt nogui`;
      }
    }
  }
  // Forge: forge-*-universal.jar
  if (!startupCommand) {
    const mcVerSafe = mcVersion.replace(/\./g, '\\.');
    const universalPattern = new RegExp(`^forge-${mcVerSafe}-.+-universal\\.jar$`, 'i');
    let forgeUniversal = files.find((f: string) => universalPattern.test(f));
    if (!forgeUniversal) {
      forgeUniversal = files.find((f: string) => /^forge-.+-universal\.jar$/.test(f));
    }
    if (forgeUniversal) {
      console.log(`[Detector] Forge universal jar: ${forgeUniversal}`);
      detectedLoader = 'forge';
      startupCommand = `java -jar ${forgeUniversal} nogui`;
    }
  }
  // Forge: forge-*.jar (sem installer)
  if (!startupCommand) {
    const mcVerSafe = mcVersion.replace(/\./g, '\\.');
    const forgeJarPattern = new RegExp(`^forge-${mcVerSafe}-.+\.jar$`, 'i');
    let forgeJar = files.find((f: string) => forgeJarPattern.test(f) && !f.includes('-installer'));
    if (!forgeJar) {
      forgeJar = files.find((f: string) => /^forge-.+\.jar$/.test(f) && !f.includes('-installer'));
    }
    if (forgeJar) {
      console.log(`[Detector] Forge jar: ${forgeJar}`);
      detectedLoader = 'forge';
      startupCommand = `java -jar ${forgeJar} nogui`;
    }
  }
  // Fabric: fabric-server-launch.jar
  if (!startupCommand && files.includes('fabric-server-launch.jar')) {
    console.log('[Detector] Fabric server launch encontrado');
    detectedLoader = 'fabric';
    startupCommand = 'java -jar fabric-server-launch.jar nogui';
  }
  // Quilt: quilt-server-launch.jar
  if (!startupCommand && files.includes('quilt-server-launch.jar')) {
    console.log('[Detector] Quilt server launch encontrado');
    detectedLoader = 'quilt';
    startupCommand = 'java -jar quilt-server-launch.jar nogui';
  }
  // Vanilla: server.jar (último recurso)
  if (!startupCommand && files.includes('server.jar')) {
    console.log('[Detector] server.jar encontrado (fallback vanilla)');
    detectedLoader = 'vanilla';
    startupCommand = 'java -jar server.jar nogui';
  }

  // --- ETAPA 3: Se não detectou loader mas tem mods/config, é "files_only" ---
  const hasMods = await directoryExists(path.join(serverDir, 'mods'));
  const hasConfig = await directoryExists(path.join(serverDir, 'config'));
  if (!startupCommand && (hasMods || hasConfig)) {
    console.log(`[Detector] Modpack sem loader detectado (files_only). Mods: ${hasMods}, Config: ${hasConfig}`);
    // Usa o loader do banco de dados, ou tenta inferir
    if (modpackType !== 'unknown') {
      detectedLoader = modpackType;
    } else {
      // Tenta inferir olhando os mods
      try {
        const modFiles = await fs.readdir(path.join(serverDir, 'mods'));
        const hasFabric = modFiles.some((f: string) => f.includes('fabric') || f.includes('cloth-config'));
        const hasForge = modFiles.some((f: string) => f.includes('forge') || f.includes('ftb'));
        detectedLoader = hasFabric && !hasForge ? 'fabric' : 'forge';
      } catch (e) {
        detectedLoader = 'forge'; // fallback mais comum
      }
    }
    console.log(`[Detector] Loader inferido para instalação automática: ${detectedLoader}`);
    
    // Instala o loader automaticamente
    try {
      if (detectedLoader === 'fabric') {
        await installFabricLoader(serverDir, mcVersion);
        if (files.includes('fabric-server-launch.jar') || await fileExists(path.join(serverDir, 'fabric-server-launch.jar'))) {
          startupCommand = 'java -jar fabric-server-launch.jar nogui';
        }
      } else if (detectedLoader === 'forge') {
        await installForgeFromManifest(serverDir, mcVersion, version);
        // Re-escaneia para achar o jar criado
        const updatedFiles = await fs.readdir(serverDir);
        const forgeJar = updatedFiles.find((f: string) => /^forge-.+\.jar$/.test(f) && !f.includes('-installer'));
        if (forgeJar) {
          startupCommand = `java -jar ${forgeJar} nogui`;
        }
      } else if (detectedLoader === 'neoforge') {
        await installNeoForgeFromManifest(serverDir, mcVersion, version);
        if (files.includes('startserver.sh') || await fileExists(path.join(serverDir, 'startserver.sh'))) {
          startupCommand = 'bash startserver.sh';
        }
      }
    } catch (e: any) {
      console.error(`[Detector] Falha ao instalar loader automaticamente: ${e?.message || e}`);
    }
  }

  // --- ETAPA 4: Cria auto-install.sh como wrapper se necessário ---
  if (installerJar || files.includes('LaunchServer.sh') || files.includes('ServerStart.sh') || files.includes('Install.sh')) {
    console.log(`[Detector] Criando auto-install.sh para o modpack...`);
    const wrapperScript = `#!/bin/bash
INSTALLER_JAR="${installerJar || ''}"
LOG_FILE="installer.log"

# Pre-baixa o server.jar para 1.12.2 se necessario para evitar erro no Forge Installer
if [ -n "$INSTALLER_JAR" ]; then
  MC_VERSION=$(echo "$INSTALLER_JAR" | cut -d'-' -f2)
  SERVER_JAR_NAME="minecraft_server.$MC_VERSION.jar"
  if [ "$MC_VERSION" = "1.12.2" ] && [ ! -f "$SERVER_JAR_NAME" ]; then
    echo "[Modpack Installer] Pre-downloading vanilla server.jar for 1.12.2..."
    curl -fsSL "https://piston-data.mojang.com/v1/objects/886945bfb2b978778c3a0288fd7fab09d315b25f/server.jar" -o "$SERVER_JAR_NAME"
    cp "$SERVER_JAR_NAME" "server.jar"
  fi
fi

if [ -f "Install.sh" ] && [ ! -d "libraries" ]; then
  echo "[Modpack Installer] Rodando Install.sh do modpack..."
  bash Install.sh
fi

if [ -n "$INSTALLER_JAR" ]; then
  EXPECTED_JAR="\${INSTALLER_JAR/-installer.jar/.jar}"
  findForgeJar() {
    [ -f "$EXPECTED_JAR" ] && { echo "$EXPECTED_JAR"; return; }
    local universal=$(ls -1 forge-*-universal.jar 2>/dev/null | head -1)
    [ -n "$universal" ] && { echo "$universal"; return; }
    local forgejar=$(ls -1 forge-*.jar 2>/dev/null | grep -v installer | head -1)
    [ -n "$forgejar" ] && { echo "$forgejar"; return; }
    echo ""
  }

  SERVER_JAR=$(findForgeJar)
  if [ -z "$SERVER_JAR" ]; then
    echo "[Modpack Installer] Install.sh nao gerou o Forge jar. Rodando instalador manual..."
    java -jar "$INSTALLER_JAR" -installServer > "$LOG_FILE" 2>&1
    SERVER_JAR=$(findForgeJar)
  fi
fi

if [ -f "LaunchServer.sh" ]; then
  echo "[Modpack Installer] Starting via LaunchServer.sh..."
  bash LaunchServer.sh
elif [ -f "ServerStart.sh" ]; then
  echo "[Modpack Installer] Starting via ServerStart.sh..."
  bash ServerStart.sh
elif [ -f "startserver.sh" ]; then
  echo "[Modpack Installer] Starting via startserver.sh..."
  bash startserver.sh
else
  SERVER_JAR=$(findForgeJar)
  if [ -n "$SERVER_JAR" ]; then
    echo "[Modpack Installer] Starting: $SERVER_JAR"
    java -jar "$SERVER_JAR" nogui
  else
    echo "[Modpack Installer] Nao encontrou script nem jar."
    exit 1
  fi
fi
`;
    await fs.writeFile(path.join(serverDir, 'auto-install.sh'), wrapperScript, 'utf-8');
    await execAsync(`chmod +x ${path.join(serverDir, 'auto-install.sh')}`);
    startupCommand = 'bash auto-install.sh';
  }

  // --- ETAPA 5: Se ainda não tem startup, falha com erro claro ---
  if (!startupCommand) {
    console.error('[Detector] ERROR: Não foi possível detectar o loader nem script de startup.');
    console.error('[Detector] Arquivos encontrados: ' + files.join(', '));
    return null;
  }

  // Atualiza startup via API (opcional - requer API key configurada)
  const apiKey = await getPanelApiKey();
  if (!apiKey) {
    console.warn('[Startup] API Key não configurada. Startup não atualizado no painel, mas auto-install.sh foi criado.');
    return startupCommand;
  }

  try {
    const internalId = await getServerInternalId(serverId);
    if (!internalId) {
      console.warn('[Startup] ID interno não encontrado, startup não atualizado.');
      return startupCommand;
    }

    const getRes = await fetch(`https://host.foxy-mc.com/api/application/servers/${internalId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    });

    let serverData: any = {};
    if (getRes.ok) {
      const fullData = await getRes.json() as any;
      serverData = fullData.attributes || {};
    }

    const response = await fetch(`https://host.foxy-mc.com/api/application/servers/${internalId}/startup`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        startup: startupCommand,
        environment: serverData.container?.environment || {},
        egg: serverData.egg || 1,
        image: getJavaImageForVersion(mcVersion),
        skip_scripts: false
      })
    });

    if (response.ok) {
      console.log(`[Startup] Comando de startup atualizado: ${startupCommand}`);
    } else {
      const errorData = await response.text();
      console.error(`[Startup] API retornou ${response.status}: ${errorData}`);
    }
  } catch (e: any) {
    console.error('[Startup] Falha ao atualizar startup:', e?.message || String(e));
  }

  return startupCommand;
}

async function detectMinecraftVersion(serverDir: string, version: any): Promise<string> {
  // 1. Tenta usar versao do banco de dados (relação modpack ou propriedades diretas)
  if (version.modpack?.minecraft_version) {
    return version.modpack.minecraft_version;
  }
  if (version.modpack?.minecraftVersion) {
    return version.modpack.minecraftVersion;
  }
  if (version.minecraft_version) {
    return version.minecraft_version;
  }
  if (version.minecraftVersion) {
    return version.minecraftVersion;
  }
  
  // 2. Tenta extrair do manifest.json do modpack
  try {
    const manifestPath = path.join(serverDir, 'manifest.json');
    if (await fileExists(manifestPath)) {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      if (manifest.minecraft?.version) {
        return manifest.minecraft.version;
      }
    }
  } catch (e) {
    // ignora
  }
  
  // 3. Tenta inferir pelo nome do modpack
  const modpackName = (version.modpack?.name || '').toLowerCase();
  if (modpackName.includes('rlcraft')) return '1.12.2';
  if (modpackName.includes('stoneblock')) return '1.12.2';
  if (modpackName.includes('skyfactory') && modpackName.includes('4')) return '1.12.2';
  if (modpackName.includes('atm10') || modpackName.includes('all the mods 10')) return '1.21.1';
  if (modpackName.includes('atm9') || modpackName.includes('all the mods 9')) return '1.20.1';
  if (modpackName.includes('atm8') || modpackName.includes('all the mods 8')) return '1.19.2';
  
  // 4. Se tiver um instalador forge-xxx, tenta extrair a versão do nome do instalador
  try {
    const files = await fs.readdir(serverDir);
    const installer = files.find(f => f.startsWith('forge-') && f.endsWith('-installer.jar'));
    if (installer) {
      // forge-1.12.2-14.23.5.2836-installer.jar -> extrai "1.12.2"
      const parts = installer.split('-');
      if (parts.length >= 2) {
        const potentialVersion = parts[1];
        if (potentialVersion.split('.').length >= 2) {
          return potentialVersion;
        }
      }
    }
  } catch (e) {
    // ignora
  }

  // 5. Fallback padrao
  return '1.20.1';
}

function parseMcVersion(mcVersion: string): number[] {
  const parts = mcVersion.split('.').map(Number);
  return parts.length >= 2 ? parts : [1, 0, 0];
}

function compareMcVersion(a: string, b: string): number {
  const av = parseMcVersion(a);
  const bv = parseMcVersion(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const avp = av[i] || 0;
    const bvp = bv[i] || 0;
    if (avp !== bvp) return avp - bvp;
  }
  return 0;
}

function getJavaImageForVersion(mcVersion: string): string {
  // Range-based mapping: version >= threshold gets the specified image
  const ranges: { min: string; image: string }[] = [
    { min: '1.20.5', image: 'ghcr.io/ptero-eggs/yolks:java_21' },
    { min: '1.17',   image: 'ghcr.io/ptero-eggs/yolks:java_17' },
    { min: '1.16',   image: 'ghcr.io/ptero-eggs/yolks:java_11' },
    { min: '1.0',    image: 'ghcr.io/ptero-eggs/yolks:java_8' },
  ];
  for (const range of ranges) {
    if (compareMcVersion(mcVersion, range.min) >= 0) {
      return range.image;
    }
  }
  return 'ghcr.io/ptero-eggs/yolks:java_17';
}

async function installForge(serverDir: string, mcVersion: string, log: string[], specificForgeVersion?: string): Promise<void> {
  let forgeVersion: string | undefined = undefined;
  
  if (specificForgeVersion) {
    // Usa versão específica detectada do manifest
    forgeVersion = specificForgeVersion;
    log.push(`[${new Date().toISOString()}] Usando Forge ${forgeVersion} (passado como parametro)`);
  } else {
    // Tenta detectar do manifest.json primeiro
    try {
      const manifestPath = path.join(serverDir, 'manifest.json');
      if (await fileExists(manifestPath)) {
        const manifestContent = await fs.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestContent);
        const loaders = manifest.minecraft?.modLoaders || [];
        const forgeLoader = loaders.find((l: any) => l.id && l.id.startsWith('forge-'));
        if (forgeLoader) {
          forgeVersion = forgeLoader.id.replace('forge-', '');
          log.push(`[${new Date().toISOString()}] Forge version detectada do manifest.json: ${forgeVersion}`);
        }
      }
    } catch (e) {
      // Ignora erro, usa fallback
    }
    
    // Se nao detectou do manifest, usa mapeamento
    if (!forgeVersion) {
      const forgeVersions: Record<string, string> = {
        '1.12.2': '1.12.2-14.23.5.2859',
        '1.16.4': '1.16.4-35.1.37',
        '1.16.5': '1.16.5-36.2.39',
        '1.18.1': '1.18.1-39.1.2',
        '1.18.2': '1.18.2-40.2.0',
        '1.19.2': '1.19.2-43.2.0',
        '1.19.4': '1.19.4-45.1.0',
        '1.20.1': '1.20.1-47.2.0',
        '1.20.4': '1.20.4-49.0.3',
      };
      
      if (forgeVersions[mcVersion]) {
        forgeVersion = forgeVersions[mcVersion];
      } else {
        log.push(`[${new Date().toISOString()}] AVISO: Versao ${mcVersion} nao mapeada para Forge. Abortando.`);
        throw new Error(`Versão do Forge não mapeada para Minecraft ${mcVersion}`);
      }
    }
  }
  if (!forgeVersion) {
    throw new Error(`Versão do Forge não conhecida para Minecraft ${mcVersion}`);
  }
  
  const forgeInstaller = `forge-${forgeVersion}-installer.jar`;
  const installerPath = path.join(serverDir, forgeInstaller);
  
  // Se o instalador já existe (ex: server pack já incluiu), pula o download
  const installerExists = await fileExists(installerPath);
  if (installerExists) {
    log.push(`[${new Date().toISOString()}] Instalador Forge já existe em ${installerPath}, pulando download`);
  } else {
    const forgeUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeVersion}/${forgeInstaller}`;
    log.push(`[${new Date().toISOString()}] Baixando Forge ${forgeVersion}...`);
    try {
      await downloadFile(forgeUrl, installerPath);
    } catch (forgeDownloadErr: any) {
    log.push(`[${new Date().toISOString()}] AVISO: Falha ao baixar Forge ${forgeVersion}: ${forgeDownloadErr.message}`);
    // Se der 404, tenta versão recomendada mais genérica (última parte do version string)
    if (forgeDownloadErr.message.includes('404')) {
      const parts = forgeVersion.split('-');
      const mcPart = parts[0];
      const forgePart = parts[1] || '';
      // Tenta sem a parte extra (ex: 1.12.2-14.23.5.2860 → 1.12.2-14.23.5.2860 é a única)
      // Ou tenta com o formato mais comum
      const altVersions = [
        `${mcPart}-${forgePart}`,
        `${mcPart}-${forgePart}-${mcPart}`,
      ];
      let downloaded = false;
      for (const altVer of altVersions) {
        if (altVer === forgeVersion) continue;
        const altInstaller = `forge-${altVer}-installer.jar`;
        const altUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${altVer}/${altInstaller}`;
        log.push(`[${new Date().toISOString()}] Tentando versão alternativa: ${altUrl}`);
        try {
          await downloadFile(altUrl, installerPath);
          log.push(`[${new Date().toISOString()}] Forge alternativo baixado com sucesso: ${altVer}`);
          downloaded = true;
          break;
        } catch (e: any) {
          log.push(`[${new Date().toISOString()}] Alternativa ${altVer} também falhou: ${e.message}`);
        }
      }
      if (!downloaded) {
        // Último fallback: tenta no servidor antigo do Forge
        const fallbackUrl = `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${forgeVersion}/${forgeInstaller}`;
        log.push(`[${new Date().toISOString()}] Tentando fallback no files.minecraftforge.net: ${fallbackUrl}`);
        try {
          await downloadFile(fallbackUrl, installerPath);
          log.push(`[${new Date().toISOString()}] Forge baixado via fallback com sucesso`);
          downloaded = true;
        } catch (fallbackErr: any) {
          log.push(`[${new Date().toISOString()}] Fallback também falhou: ${fallbackErr.message}`);
        }
      }
      if (!downloaded) {
        throw new Error(`Não foi possível baixar o instalador do Forge para ${mcVersion}. Verifique se a versão existe.`);
      }
    } else {
      throw forgeDownloadErr;
    }
  }
  }
  
  log.push(`[${new Date().toISOString()}] Instalando Forge...`);
  const javaImage = getJavaImageForVersion(mcVersion);
  await runCommandWithLog(`docker run --rm --user root -v ${serverDir}:/data -w /data ${javaImage} java -jar ${forgeInstaller} -installServer`, log);
  
  log.push(`[${new Date().toISOString()}] Forge instalado com sucesso`);
}

async function installNeoForge(serverDir: string, mcVersion: string, log: string[], specificNeoForgeVersion?: string): Promise<void> {
  let neoForgeVersion: string | undefined = undefined;
  
  if (specificNeoForgeVersion) {
    neoForgeVersion = specificNeoForgeVersion;
    log.push(`[${new Date().toISOString()}] Usando NeoForge ${neoForgeVersion} (passado como parametro)`);
  } else {
    // Tenta detectar do manifest.json
    try {
      const manifestPath = path.join(serverDir, 'manifest.json');
      if (await fileExists(manifestPath)) {
        const manifestContent = await fs.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestContent);
        const loaders = manifest.minecraft?.modLoaders || [];
        const neoForgeLoader = loaders.find((l: any) => l.id && l.id.startsWith('neoforge-'));
        if (neoForgeLoader) {
          neoForgeVersion = neoForgeLoader.id.replace('neoforge-', '');
          log.push(`[${new Date().toISOString()}] NeoForge version detectada do manifest.json: ${neoForgeVersion}`);
        }
      }
    } catch (e) {
      // Ignora erro
    }
    
    // Fallback para mapeamento
    if (!neoForgeVersion) {
      const neoForgeVersions: Record<string, string> = {
        '1.20.1': '20.2.59',
        '1.20.4': '20.4.237',
        '1.21.1': '21.1.143'
      };
      
      if (neoForgeVersions[mcVersion]) {
        neoForgeVersion = neoForgeVersions[mcVersion];
      } else {
        log.push(`[${new Date().toISOString()}] AVISO: Versao ${mcVersion} nao mapeada para NeoForge`);
        throw new Error(`Versão do NeoForge não conhecida para Minecraft ${mcVersion}`);
      }
    }
  }
  
  const neoForgeInstaller = `neoforge-${neoForgeVersion}-installer.jar`;
  const installerPath = path.join(serverDir, neoForgeInstaller);
  
  const neoForgeInstallerExists = await fileExists(installerPath);
  if (neoForgeInstallerExists) {
    log.push(`[${new Date().toISOString()}] Instalador NeoForge já existe em ${installerPath}, pulando download`);
  } else {
    const neoForgeUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoForgeVersion}/${neoForgeInstaller}`;
    log.push(`[${new Date().toISOString()}] Baixando NeoForge ${neoForgeVersion}...`);
    try {
      await downloadFile(neoForgeUrl, installerPath);
    } catch (neoDownloadErr: any) {
      log.push(`[${new Date().toISOString()}] AVISO: Falha ao baixar NeoForge ${neoForgeVersion}: ${neoDownloadErr.message}`);
      throw new Error(`Não foi possível baixar o instalador do NeoForge ${neoForgeVersion}: ${neoDownloadErr.message}`);
    }
  }
  
  log.push(`[${new Date().toISOString()}] Instalando NeoForge...`);
  const javaImage = getJavaImageForVersion(mcVersion);
  await runCommandWithLog(`docker run --rm --user root -v ${serverDir}:/data -w /data ${javaImage} java -jar ${neoForgeInstaller} -installServer`, log);
  
  log.push(`[${new Date().toISOString()}] NeoForge instalado com sucesso`);
}

async function installFabricLoader(serverDir: string, mcVersion: string): Promise<void> {
  console.log(`[AutoInstall] Installing Fabric for MC ${mcVersion}...`);
  const installerUrl = 'https://meta.fabricmc.net/v2/versions/installer';
  const installerRes = await fetch(installerUrl);
  const installerVersions = await installerRes.json() as any[];
  const latestInstaller = installerVersions[0]?.url || 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.0/fabric-installer-1.0.0.jar';
  
  const installerPath = path.join(serverDir, 'fabric-installer.jar');
  await downloadFile(latestInstaller, installerPath);
  
  await execAsync(`cd ${serverDir} && java -jar fabric-installer.jar server -mcversion ${mcVersion} -downloadMinecraft`);
  console.log(`[AutoInstall] Fabric installed for MC ${mcVersion}`);
}

async function installForgeFromManifest(serverDir: string, mcVersion: string, version: any): Promise<void> {
  console.log(`[AutoInstall] Installing Forge for MC ${mcVersion}...`);
  const log: string[] = [];
  
  // Tenta usar versão do manifest
  let forgeVersion = version?.loaderVersion;
  if (!forgeVersion) {
    // Mapa de fallback para versões comuns
    const forgeVersions: Record<string, string> = {
      '1.12.2': '14.23.5.2860',
      '1.16.5': '36.2.39',
      '1.18.2': '40.2.0',
      '1.19.2': '43.2.0',
      '1.20.1': '47.1.3'
    };
    forgeVersion = forgeVersions[mcVersion];
  }
  
  if (forgeVersion) {
    await installForge(serverDir, mcVersion, log, forgeVersion);
    console.log(`[AutoInstall] Forge ${forgeVersion} installed for MC ${mcVersion}`);
  } else {
    throw new Error(`Unknown Forge version for MC ${mcVersion}`);
  }
}

async function installNeoForgeFromManifest(serverDir: string, mcVersion: string, version: any): Promise<void> {
  console.log(`[AutoInstall] Installing NeoForge for MC ${mcVersion}...`);
  const log: string[] = [];
  
  let neoForgeVersion = version?.loaderVersion;
  if (!neoForgeVersion) {
    const neoForgeVersions: Record<string, string> = {
      '1.20.1': '20.2.59',
      '1.20.4': '20.4.237',
      '1.21.1': '21.1.143'
    };
    neoForgeVersion = neoForgeVersions[mcVersion];
  }
  
  if (neoForgeVersion) {
    await installNeoForge(serverDir, mcVersion, log, neoForgeVersion);
    console.log(`[AutoInstall] NeoForge ${neoForgeVersion} installed for MC ${mcVersion}`);
  } else {
    throw new Error(`Unknown NeoForge version for MC ${mcVersion}`);
  }
}

async function cleanServerDir(serverDir: string): Promise<void> {
  const preserve = ['.pteroignore'];
  const files = await fs.readdir(serverDir);
  
  for (const file of files) {
    if (preserve.includes(file)) continue;
    
    const filePath = path.join(serverDir, file);
    try {
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        await fs.rm(filePath, { recursive: true, force: true });
      } else {
        await fs.unlink(filePath);
      }
    } catch (e) {
      // Ignora erros de permissão
    }
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
    const dbKey = result?.[0]?.value;
    if (dbKey && dbKey.trim() !== '') {
      return dbKey;
    }
  } catch {}
  return process.env.CURSEFORGE_API_KEY || null;
}

function getTruncatedLog(logArray: string[]): string {
  const fullLog = logArray.join('\n');
  if (fullLog.length > 60000) {
    return `[... LOG TRUNCADO DEVIDO AO TAMANHO DE MODPACK MUITO GRANDE ...]\n\n` + fullLog.substring(fullLog.length - 60000);
  }
  return fullLog;
}

async function removeClientSideMods(modsDir: string, log: string[]): Promise<void> {
  // Lista de padrões de nomes de mods client-side comuns
  const clientSidePatterns = [
    'colorwheel_patcher',
    'colorwheel',
    'replaymod',
    'iris',
    'sodium',
    'zoom',
    'journeymap',
    'xaero',
    'optifine',
    'optifabric',
    'appleskin',
    'litematica',
    'minihud',
    'tweakeroo',
    'itemscroller',
    'wdl',
    'worlddownloader',
    'nvidium',
    'moreculling',
    'entityculling',
    'betterfps',
    'foamfix',
    'texfix',
    'vanillaenhancements',
    'voxelmap',
    'antiqueatlas',
    'craftpresence',
    'discordrpc',
    'lambdynlights',
    'okzoomer',
    'roughlyenoughitems',
    'emi',
    // NOTA: JEI é removido daqui! Ele tem funcionalidades server-side e é dependência obrigatória
    // de mods como JustEnoughResources, JustEnoughProfessions, etc.
    'controlling',
    'modmenu',
    'shulkerboxtooltip',
    'neat',
    'torohealth',
    'damageindicators',
    'armorhud',
    'durabilityviewer',
    'inventoryhud',
    'itemphysic',
    'soundfilters',
    'soundphysics',
    'dynamic surroundings',
    'ambientsounds',
    'biomeinfo',
    'FPS-Monitor',
    'debugify',
    'authme',
    'reauth',
    'tlauncher',
    'tl_skin',
    'waveycapes',
    'capes',
    'cosmetic',
    'skin',
    '3dskin',
    'citresewn',
    'continuity',
    'enhancedblockentities',
    'entitytexturefeatures',
    'fallingleaves',
    'visuality',
    'clear-skies',
    'custom-splash-screen',
    'fancymenu',
    'melody',
    'loadmyresources',
    'respackopts',
    'rrls',
    'remove-reloading-screen',
    'smoke-suppression',
    'smooth-boot',
    'sparkweave',
  ];
  
  try {
    if (!await directoryExists(modsDir)) {
      return;
    }
    
    const files = await fs.readdir(modsDir);
    const removed: string[] = [];
    
    for (const file of files) {
      if (!file.endsWith('.jar')) continue;
      
      const lowerFile = file.toLowerCase();
      const isClientSide = clientSidePatterns.some(pattern => {
        // Escapa caracteres especiais do pattern e cria uma regex com limites de palavra/hífen/underline
        const escapedPattern = pattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`(^|[-_])${escapedPattern}([-_\\d.]|$)`, 'i');
        return regex.test(lowerFile);
      });
      
      if (isClientSide) {
        const filePath = path.join(modsDir, file);
        await fs.unlink(filePath);
        removed.push(file);
        log.push(`[${new Date().toISOString()}] [ClientSide] Removido: ${file}`);
      }
    }
    
    if (removed.length > 0) {
      log.push(`[${new Date().toISOString()}] [ClientSide] Total de mods client-side removidos: ${removed.length}`);
    } else {
      log.push(`[${new Date().toISOString()}] [ClientSide] Nenhum mod client-side detectado`);
    }
  } catch (e: any) {
    log.push(`[${new Date().toISOString()}] [ClientSide] AVISO: Falha ao remover mods client-side: ${e.message}`);
  }
}

interface AutoDetectedLoader {
  loader: 'Forge' | 'Fabric' | 'NeoForge' | 'Vanilla';
  loaderVersion: string;
  minecraftVersion: string;
}

async function autoDetectModloader(serverDir: string, version: any, log: string[]): Promise<AutoDetectedLoader> {
  log.push(`[${new Date().toISOString()}] [Auto-Detector] Iniciando auto-detecção de Modloader...`);
  
  let loader: 'Forge' | 'Fabric' | 'NeoForge' | 'Vanilla' = 'Vanilla';
  let loaderVersion = '';
  let minecraftVersion = version?.modpack?.minecraft_version || version?.minecraft_version || version?.minecraftVersion || version?.modpack?.minecraftVersion || '';

  // 1. Verifica manifest.json (CurseForge Pack)
  try {
    const manifestPath = path.join(serverDir, 'manifest.json');
    if (await fileExists(manifestPath)) {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      
      if (manifest.minecraft?.version) {
        minecraftVersion = manifest.minecraft.version;
      }
      
      const loaders = manifest.minecraft?.modLoaders || [];
      const primaryLoader = loaders[0];
      
      if (primaryLoader && primaryLoader.id) {
        const idLower = primaryLoader.id.toLowerCase();
        if (idLower.startsWith('neoforge-')) {
          loader = 'NeoForge';
          loaderVersion = primaryLoader.id.replace(/^neoforge-/i, '');
        } else if (idLower.startsWith('forge-')) {
          loader = 'Forge';
          loaderVersion = primaryLoader.id.replace(/^forge-/i, '');
        } else if (idLower.startsWith('fabric-')) {
          loader = 'Fabric';
          loaderVersion = primaryLoader.id.replace(/^fabric-/i, '');
        }
        
        log.push(`[${new Date().toISOString()}] [Auto-Detector] Detectado do manifest.json: ${loader} v${loaderVersion} (Minecraft v${minecraftVersion})`);
        return { loader, loaderVersion, minecraftVersion };
      }
    }
  } catch (e: any) {
    log.push(`[${new Date().toISOString()}] [Auto-Detector] Aviso ao analisar manifest.json: ${e.message}`);
  }

  // 2. Verifica modrinth.index.json (Modrinth Pack)
  try {
    const indexPath = path.join(serverDir, 'modrinth.index.json');
    if (await directoryExists(indexPath)) {
      const content = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(content);
      
      if (index.dependencies?.minecraft) {
        minecraftVersion = index.dependencies.minecraft;
      }
      
      if (index.dependencies?.['fabric-loader']) {
        loader = 'Fabric';
        loaderVersion = index.dependencies['fabric-loader'];
      } else if (index.dependencies?.['neoforge']) {
        loader = 'NeoForge';
        loaderVersion = index.dependencies['neoforge'];
      } else if (index.dependencies?.['forge']) {
        loader = 'Forge';
        loaderVersion = index.dependencies['forge'];
      }

      if (loader !== 'Vanilla') {
        log.push(`[${new Date().toISOString()}] [Auto-Detector] Detectado do modrinth.index.json: ${loader} v${loaderVersion} (Minecraft v${minecraftVersion})`);
        return { loader, loaderVersion, minecraftVersion };
      }
    }
  } catch (e: any) {
    log.push(`[${new Date().toISOString()}] [Auto-Detector] Aviso ao analisar modrinth.index.json: ${e.message}`);
  }

  // 3. Varre arquivos para ver se há instaladores ou arquivos launcher já presentes
  try {
    const files = await fs.readdir(serverDir);
    
    // NeoForge
    const nfInstaller = files.find(f => f.startsWith('neoforge-') && f.endsWith('-installer.jar'));
    if (nfInstaller) {
      loader = 'NeoForge';
      loaderVersion = nfInstaller.replace(/^neoforge-/i, '').replace(/-installer\.jar$/i, '');
      log.push(`[${new Date().toISOString()}] [Auto-Detector] Detectado instalador NeoForge: ${nfInstaller}`);
      return { loader, loaderVersion, minecraftVersion };
    }
    
    // Forge
    const forgeInstaller = files.find(f => f.startsWith('forge-') && f.endsWith('-installer.jar'));
    if (forgeInstaller) {
      loader = 'Forge';
      loaderVersion = forgeInstaller.replace(/^forge-/i, '').replace(/-installer\.jar$/i, '');
      log.push(`[${new Date().toISOString()}] [Auto-Detector] Detectado instalador Forge: ${forgeInstaller}`);
      return { loader, loaderVersion, minecraftVersion };
    }
    
    // Forge execution jar (ex: forge-1.16.5-36.2.34.jar)
    const forgeJar = files.find((f: string) => /^forge-.+\.jar$/.test(f) && !f.includes('-installer'));
    if (forgeJar) {
      loader = 'Forge';
      loaderVersion = forgeJar.replace(/^forge-/i, '').replace(/\.jar$/i, '');
      log.push(`[${new Date().toISOString()}] [Auto-Detector] Detectado jar executável do Forge: ${forgeJar}`);
      return { loader, loaderVersion, minecraftVersion };
    }
    
    // Fabric
    if (files.includes('fabric-server-launch.jar') || files.some(f => f.startsWith('fabric-loader-') || f.startsWith('fabric-server-'))) {
      loader = 'Fabric';
      log.push(`[${new Date().toISOString()}] [Auto-Detector] Detectado arquivos Fabric no diretório`);
      return { loader, loaderVersion, minecraftVersion };
    }
  } catch (e: any) {
    log.push(`[${new Date().toISOString()}] [Auto-Detector] Aviso ao ler diretório do servidor: ${e.message}`);
  }

  // 4. Fallback para os dados passados pelo banco de dados / frontend
  const dbLoader = (version.modpack?.modloader || version.loader || '').toLowerCase();
  if (dbLoader.includes('neoforge')) {
    loader = 'NeoForge';
  } else if (dbLoader.includes('forge')) {
    loader = 'Forge';
  } else if (dbLoader.includes('fabric')) {
    loader = 'Fabric';
  }

  if (loader !== 'Vanilla') {
    log.push(`[${new Date().toISOString()}] [Auto-Detector] Detectado do banco de dados/metadados: ${loader} (Minecraft v${minecraftVersion})`);
  } else {
    log.push(`[${new Date().toISOString()}] [Auto-Detector] Nenhum modloader detectado, assumindo Vanilla`);
  }

  return { loader, loaderVersion, minecraftVersion };
}
