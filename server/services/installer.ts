import { prisma } from '../index';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

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
  
  try {
    log.push(`[${new Date().toISOString()}] Iniciando instalação: ${version.modpack.name} ${version.version}`);
    
    // Diretório do servidor (exemplo - ajustar conforme estrutura Jexactyl)
    const serverDir = `/var/lib/pterodactyl/volumes/${serverId}`;
    
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
          log.push(`[${new Date().toISOString()}] Fabric detectado mas server.jar não encontrado, iniciando configuração...`);
          await configureFabric(serverDir, { ...version, minecraftVersion: detected.minecraftVersion, loaderVersion: detected.loaderVersion });
        }
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
    
    // Verifica se o modpack já tem conteúdo de servidor (Server Pack)
    const hasModsDir = await directoryExists(path.join(serverDir, 'mods'));
    const hasConfigDir = await directoryExists(path.join(serverDir, 'config'));
    const hasStartupScript = (await fs.readdir(serverDir)).some((f: string) => 
      f === 'startserver.sh' || f === 'run.sh' || f === 'run.bat'
    );
    const hasForgeUniversal = (await fs.readdir(serverDir)).some((f: string) => 
      /^forge-.+-universal\.jar$/.test(f)
    );
    const hasNeoForgeInstaller = (await fs.readdir(serverDir)).some((f: string) => 
      f.startsWith('neoforge-') && f.endsWith('-installer.jar')
    );
    const isServerPack = hasModsDir || hasConfigDir || hasStartupScript || hasForgeUniversal || hasNeoForgeInstaller;
    
    if (isServerPack) {
      log.push(`[${new Date().toISOString()}] Server Pack detectado (mods=${hasModsDir}, config=${hasConfigDir}, script=${hasStartupScript}, forge=${hasForgeUniversal}, neoforge=${hasNeoForgeInstaller})`);
      log.push(`[${new Date().toISOString()}] Pulando download de server.jar vanilla`);
    }
    
    // Verifica se server.jar existe - ESSENCIAL para iniciar
    const serverJarPath = path.join(serverDir, 'server.jar');
    if (!isServerPack && !await fileExists(serverJarPath)) {
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
    
    // Detecta e configura startup automaticamente
    log.push(`[${new Date().toISOString()}] Detectando tipo de modpack e configurando startup...`);
    try {
      const mcVersion = await detectMinecraftVersion(serverDir, version);
      const startupCmd = await detectAndConfigureStartup(serverId, serverDir, mcVersion, version);
      if (startupCmd) {
        log.push(`[${new Date().toISOString()}] Startup configurado: ${startupCmd}`);
      } else {
        log.push(`[${new Date().toISOString()}] AVISO: Não foi possível detectar startup automaticamente`);
      }
    } catch (e: any) {
      log.push(`[${new Date().toISOString()}] AVISO: Falha ao configurar startup: ${e?.message || e}`);
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
    
    // Baixa cada arquivo listado no index (ignora mods client-side)
    for (const file of index.files || []) {
      // Verifica se é mod client-side (env.server === 'unsupported')
      if (file.env?.server === 'unsupported') {
        console.log(`[Modrinth] IGNORADO (Client-Side): ${file.path}`);
        continue; // Pula o download deste mod
      }
      
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
  const apiKey = await getPanelApiKey();
  if (!apiKey) {
    console.warn('[Startup] API Key do painel não configurada.');
    return null;
  }

  const files = await fs.readdir(serverDir);
  let startupCommand: string | null = null;
  let detectedType = 'unknown';

  // Detecta tipo de modpack pelo nome/arquivos
  let modpackType = 'unknown';
  
  // Tenta puxar o modloader direto do objeto version fornecido pelo banco de dados / frontend
  if (version) {
    const loaderFromVer = (version.modpack?.modloader || version.loader || '').toLowerCase();
    if (loaderFromVer.includes('fabric')) modpackType = 'fabric';
    else if (loaderFromVer.includes('neoforge')) modpackType = 'neoforge';
    else if (loaderFromVer.includes('forge')) modpackType = 'forge';
    else if (loaderFromVer.includes('quilt')) modpackType = 'quilt';
    else if (loaderFromVer.includes('vanilla')) modpackType = 'vanilla';
  }

  try {
    const manifestPath = path.join(serverDir, 'manifest.json');
    if (modpackType === 'unknown' && await fileExists(manifestPath)) {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      const modpackName = (manifest.name || '').toLowerCase();
      if (modpackName.includes('bettermc')) modpackType = 'fabric';
      if (modpackName.includes('homestead')) modpackType = 'fabric';
      if (modpackName.includes('fabric')) modpackType = 'fabric';
      if (modpackName.includes('forge')) modpackType = 'forge';
      if (modpackName.includes('neoforge')) modpackType = 'neoforge';
    }
    
    // Detecta tipo verificando mods no diretório
    if (modpackType === 'unknown' && await directoryExists(path.join(serverDir, 'mods'))) {
      const modFiles = await fs.readdir(path.join(serverDir, 'mods'));
      const hasFabricMods = modFiles.some((f: string) => f.includes('fabric') || f.includes('cloth'));
      const hasForgeMods = modFiles.some((f: string) => f.includes('forge') || f.includes('ftb'));
      
      if (hasFabricMods && !hasForgeMods) modpackType = 'fabric';
      if (hasForgeMods && !hasFabricMods) modpackType = 'forge';
    }
  } catch (e) {
    // ignora
  }

  // Detector 1: startserver.sh (NeoForge/Forge Server Pack)
  if (files.includes('startserver.sh')) {
    console.log('[Detector] startserver.sh encontrado');
    detectedType = 'startserver.sh';
    startupCommand = 'bash startserver.sh';
  }
  // Detector 2: Fabric server.jar (prioridade para modpacks Fabric)
  if (!startupCommand && files.includes('server.jar') && modpackType === 'fabric') {
    console.log('[Detector] Fabric server.jar encontrado (prioridade para modpack Fabric)');
    detectedType = 'fabric-server';
    startupCommand = 'java -jar server.jar nogui';
  }
  // Detector 3: run.sh (Forge/Fabric genérico)
  else if (files.includes('run.sh')) {
    console.log('[Detector] run.sh encontrado');
    detectedType = 'run.sh';
    startupCommand = 'bash run.sh';
  }
  // Detector 3: NeoForge unix_args.txt
  else {
    const neoForgePattern = /libraries\/net\/neoforged\/neoforge\/([^/]+)\/unix_args\.txt/;
    const neoForgeMatch = files.find(f => neoForgePattern.test(f));
    if (neoForgeMatch) {
      const nfMatch = neoForgeMatch.match(neoForgePattern);
      if (nfMatch) {
        console.log(`[Detector] NeoForge unix_args.txt encontrado (v${nfMatch[1]})`);
        detectedType = 'neoforge-unix_args';
        startupCommand = `java @user_jvm_args.txt @libraries/net/neoforged/neoforge/${nfMatch[1]}/unix_args.txt nogui`;
      }
    }
  }
  // Detector 4: Forge universal jar (Forge antigo)
  if (!startupCommand) {
    const mcVerSafe = mcVersion.replace(/\./g, '\\.');
    const universalPattern = new RegExp(`^forge-${mcVerSafe}-.+-universal\\.jar$`, 'i');
    let forgeUniversal = files.find((f: string) => universalPattern.test(f));
    if (!forgeUniversal) {
      forgeUniversal = files.find((f: string) => /^forge-.+-universal\.jar$/.test(f));
    }
    if (forgeUniversal) {
      console.log(`[Detector] Forge universal jar encontrado: ${forgeUniversal}`);
      detectedType = 'forge-universal';
      startupCommand = `java -jar ${forgeUniversal} nogui`;
    }
  }
  // Detector 4b: Forge jar genérico (instalador criou forge-*.jar)
  if (!startupCommand) {
    const mcVerSafe = mcVersion.replace(/\./g, '\\.');
    const forgeJarPattern = new RegExp(`^forge-${mcVerSafe}-.+\\.jar$`, 'i');
    let forgeJar = files.find((f: string) => forgeJarPattern.test(f) && !f.includes('-installer'));
    if (!forgeJar) {
      forgeJar = files.find((f: string) => /^forge-.+\.jar$/.test(f) && !f.includes('-installer'));
    }
    if (forgeJar) {
      console.log(`[Detector] Forge jar encontrado: ${forgeJar}`);
      detectedType = 'forge-jar';
      startupCommand = `java -jar ${forgeJar} nogui`;
    }
  }
  // Detector 4c: Minecraft server jar (Forge 1.12.2 cria minecraft_server.x.x.jar)
  if (!startupCommand) {
    const mcVerSafe = mcVersion.replace(/\./g, '\\.');
    const mcServerPattern = new RegExp(`^minecraft_server\\.${mcVerSafe}\\.jar$`, 'i');
    let mcServerJar = files.find((f: string) => mcServerPattern.test(f));
    if (!mcServerJar) {
      mcServerJar = files.find((f: string) => /^minecraft_server\..+\.jar$/.test(f));
    }
    if (mcServerJar) {
      console.log(`[Detector] Minecraft server jar encontrado: ${mcServerJar}`);
      detectedType = 'minecraft-server';
      startupCommand = `java -jar ${mcServerJar} nogui`;
    }
  }
  // Detector 5: Fabric server launch
  if (!startupCommand) {
    if (files.includes('fabric-server-launch.jar')) {
      console.log('[Detector] Fabric server launch encontrado');
      detectedType = 'fabric';
      startupCommand = 'java -jar fabric-server-launch.jar nogui';
    }
  }
  // Detector 6: Quilt
  if (!startupCommand) {
    if (files.includes('quilt-server-launch.jar')) {
      console.log('[Detector] Quilt server launch encontrado');
      detectedType = 'quilt';
      startupCommand = 'java -jar quilt-server-launch.jar nogui';
    }
  }
  // Detector 7: Vanilla fallback (última opção)
  if (!startupCommand) {
    if (files.includes('server.jar')) {
      console.log('[Detector] server.jar encontrado (fallback - último recurso)');
      detectedType = 'vanilla';
      startupCommand = 'java -jar server.jar nogui';
    }
  }

  if (!startupCommand) {
    console.warn('[Detector] Nenhum startup detectado!');
    return null;
  }

  // Se for Forge ou NeoForge, e houver um installer correspondente, cria um script wrapper
  // que verifica libraries e roda o instalador automaticamente na primeira inicialização.
  const installerJar = files.find((f: string) => (f.startsWith('forge-') || f.startsWith('neoforge-')) && f.endsWith('-installer.jar'));
  if (installerJar && (detectedType.startsWith('forge') || detectedType.startsWith('neoforge') || startupCommand.startsWith('java'))) {
    console.log(`[Detector] Criando script wrapper auto-install.sh usando ${installerJar}`);
    const wrapperScript = `#!/bin/bash
# Auto-generated by Modpack Installer
# Runs installer if libraries are missing, then starts the server

if [ ! -d libraries ] || [ ! "$(ls -A libraries 2>/dev/null)" ]; then
  echo "[Modpack Installer] Libraries not found. Running installer..."
  java -jar ${installerJar} -installServer
  if [ $? -ne 0 ]; then
    echo "[Modpack Installer] Installer failed!"
    exit 1
  fi
  echo "[Modpack Installer] Libraries installed successfully."
fi

echo "[Modpack Installer] Starting server..."
${startupCommand}
`;
    await fs.writeFile(path.join(serverDir, 'auto-install.sh'), wrapperScript, 'utf-8');
    await execAsync(`chmod +x ${path.join(serverDir, 'auto-install.sh')}`);
    startupCommand = 'bash auto-install.sh';
  }

  console.log(`[Detector] Tipo detectado: ${detectedType}`);
  console.log(`[Detector] Startup escolhido: ${startupCommand}`);

  // Atualiza startup via API
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
  if (modpackName.includes('skyfactory') && modpackName.includes('4')) return '1.12.2';
  if (modpackName.includes('atm10') || modpackName.includes('all the mods 10')) return '1.21.1';
  if (modpackName.includes('atm9') || modpackName.includes('all the mods 9')) return '1.20.1';
  if (modpackName.includes('atm8') || modpackName.includes('all the mods 8')) return '1.19.2';
  
  // 4. Fallback padrao
  return '1.20.1';
}

function getJavaImageForVersion(mcVersion: string): string {
  const versionMap: Record<string, string> = {
    '1.7.10': 'ghcr.io/ptero-eggs/yolks:java_8',
    '1.8.9': 'ghcr.io/ptero-eggs/yolks:java_8',
    '1.12.2': 'ghcr.io/ptero-eggs/yolks:java_8',
    '1.16.5': 'ghcr.io/ptero-eggs/yolks:java_11',
    '1.18.2': 'ghcr.io/ptero-eggs/yolks:java_17',
    '1.19.2': 'ghcr.io/ptero-eggs/yolks:java_17',
    '1.20.1': 'ghcr.io/ptero-eggs/yolks:java_17',
    '1.20.4': 'ghcr.io/ptero-eggs/yolks:java_17',
    '1.20.6': 'ghcr.io/ptero-eggs/yolks:java_21',
    '1.21.1': 'ghcr.io/ptero-eggs/yolks:java_21',
    '1.21.4': 'ghcr.io/ptero-eggs/yolks:java_21',
  };
  return versionMap[mcVersion] || 'ghcr.io/ptero-eggs/yolks:java_17';
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
        '1.12.2': '1.12.2-14.23.5.2860',
        '1.16.5': '1.16.5-36.2.39',
        '1.18.2': '1.18.2-40.2.0',
        '1.19.2': '1.19.2-43.2.0',
        '1.20.1': '1.20.1-47.2.0'
      };
      
      if (forgeVersions[mcVersion]) {
        forgeVersion = forgeVersions[mcVersion];
      } else {
        log.push(`[${new Date().toISOString()}] AVISO: Versao ${mcVersion} nao mapeada, usando Forge 1.12.2 como fallback`);
        return await installForge(serverDir, '1.12.2', log);
      }
    }
  }
  if (!forgeVersion) {
    throw new Error(`Versão do Forge não conhecida para Minecraft ${mcVersion}`);
  }
  
  const forgeInstaller = `forge-${forgeVersion}-installer.jar`;
  const forgeUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeVersion}/${forgeInstaller}`;
  
  log.push(`[${new Date().toISOString()}] Baixando Forge ${forgeVersion}...`);
  const installerPath = path.join(serverDir, forgeInstaller);
  await downloadFile(forgeUrl, installerPath);
  
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
  const neoForgeUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoForgeVersion}/${neoForgeInstaller}`;
  
  log.push(`[${new Date().toISOString()}] Baixando NeoForge ${neoForgeVersion}...`);
  const installerPath = path.join(serverDir, neoForgeInstaller);
  await downloadFile(neoForgeUrl, installerPath);
  
  log.push(`[${new Date().toISOString()}] Instalando NeoForge...`);
  const javaImage = getJavaImageForVersion(mcVersion);
  await runCommandWithLog(`docker run --rm --user root -v ${serverDir}:/data -w /data ${javaImage} java -jar ${neoForgeInstaller} -installServer`, log);
  
  log.push(`[${new Date().toISOString()}] NeoForge instalado com sucesso`);
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
    'jei', // JEI pode ser usado em servidor, mas geralmente é opcional
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
