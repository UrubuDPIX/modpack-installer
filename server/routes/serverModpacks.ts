import { Router } from 'express';
import { prisma } from '../index';
import { installModpack, uninstallModpack } from '../services/installer';

const router = Router({ mergeParams: true });

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

// Busca modpack instalado no servidor - v2 fix schema
router.get('/:id/modpack', async (req, res) => {
  try {
    const serverModpack = await prisma.serverModpack.findFirst({
      where: { server_id: req.params.id }
    });

    if (!serverModpack) {
      return res.status(404).json({ message: 'Nenhum modpack instalado' });
    }

    const modpack = await prisma.modpack.findUnique({
      where: { id: serverModpack.modpack_id }
    });
    const version = await prisma.modpackVersion.findUnique({
      where: { id: serverModpack.modpack_version_id }
    });

    res.json({
      ...serverModpack,
      modpack: modpack || null,
      version: version || null
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar modpack do servidor', error });
  }
});

// Instala um modpack no servidor
router.post('/:id/modpack', async (req, res) => {
  try {
    const { modpack_slug, version_id, provider, delete_files, accept_eula } = req.body;
    const serverId = req.params.id;

    if (!modpack_slug || !version_id || !provider) {
      return res.status(400).json({ message: 'modpack_slug, version_id e provider são obrigatórios' });
    }

    let modpackName = modpack_slug;
    let modpackAuthor = 'unknown';
    let modpackDescription = '';
    let modpackIcon = '';
    let modpackDownloads = 0;
    let versionName = version_id;
    let minecraftVersion = 'unknown';
    let loader: 'Forge' | 'Fabric' | 'NeoForge' | 'Quilt' = 'Forge';
    let loaderVersion = 'unknown';
    let downloadUrl = '';
    let fileSize = '0';
    let releasedAt = new Date();

    if (provider === 'modrinth') {
      // Buscar projeto
      const projectRes = await fetch(`https://api.modrinth.com/v2/project/${modpack_slug}`);
      if (!projectRes.ok) {
        return res.status(400).json({ message: `Modpack ${modpack_slug} não encontrado no Modrinth` });
      }
      const project = await projectRes.json() as any;
      modpackName = project.title || modpack_slug;
      modpackAuthor = project.author || project.team || 'unknown';
      modpackDescription = project.description || '';
      modpackIcon = project.icon_url || '';
      modpackDownloads = project.downloads || 0;

      // Buscar versões disponíveis
      const versionsRes = await fetch(`https://api.modrinth.com/v2/project/${modpack_slug}/version`);
      if (!versionsRes.ok) {
        return res.status(400).json({ message: 'Não foi possível buscar versões do modpack' });
      }
      const versions = await versionsRes.json() as any[];
      if (!versions || versions.length === 0) {
        return res.status(400).json({ message: 'Nenhuma versão disponível para este modpack' });
      }

      // Se version_id for "latest", pega a primeira (mais recente)
      let ver = versions[0];
      if (version_id !== 'latest') {
        const specificVer = versions.find((v: any) => v.id === version_id || v.name === version_id);
        if (specificVer) ver = specificVer;
      }

      versionName = ver.name || version_id;
      minecraftVersion = ver.game_versions?.[0] || 'unknown';
      const rawLoader = (ver.loaders?.[0] || 'Forge').toLowerCase();
      const capitalizedLoader = rawLoader.charAt(0).toUpperCase() + rawLoader.slice(1);
      loader = ['Forge', 'Fabric', 'Neoforge', 'Quilt'].includes(capitalizedLoader) ? capitalizedLoader : 'Forge';
      loaderVersion = ver.loaders?.[0] || 'unknown';
      downloadUrl = ver.files?.[0]?.url || '';
      fileSize = String(ver.files?.[0]?.size || 0);
      releasedAt = new Date(ver.date_published) || new Date();
    } else if (provider === 'curseforge') {
      const cfKey = await getCurseForgeKey();
      if (!cfKey) {
        return res.status(400).json({ message: 'Chave da API CurseForge não configurada' });
      }
      // Buscar mod por slug
      const searchRes = await fetch(`https://api.curseforge.com/v1/mods/search?gameId=432&slug=${modpack_slug}`, {
        headers: { 'x-api-key': cfKey }
      });
      let modId = null;
      if (searchRes.ok) {
        const searchData = await searchRes.json() as any;
        if (searchData.data && searchData.data.length > 0) {
          const mod = searchData.data[0];
          modId = mod.id;
          modpackName = mod.name || modpack_slug;
          modpackAuthor = mod.authors?.[0]?.name || 'unknown';
          modpackDescription = mod.summary || '';
          modpackIcon = mod.logo?.url || '';
          modpackDownloads = mod.downloadCount || 0;
        }
      }
      
      if (!modId) {
        console.error(`[CurseForge] Mod não encontrado: ${modpack_slug}`);
        return res.status(400).json({ message: `Modpack não encontrado na CurseForge: ${modpack_slug}` });
      }
      // Buscar arquivo (version_id é o fileId)
      // Verifica se existe serverPackFileId no arquivo selecionado
      let serverFileId = version_id;
      try {
        const fileInfoRes = await fetch(`https://api.curseforge.com/v1/mods/${modId}/files/${version_id}`, {
          headers: { 'x-api-key': cfKey }
        });
        if (fileInfoRes.ok) {
          const fileInfoData = await fileInfoRes.json() as any;
          const fileInfo = fileInfoData.data;
          console.log(`[CurseForge] Arquivo selecionado: ${fileInfo.fileName}`);
          if (fileInfo.serverPackFileId) {
            console.log(`[CurseForge] ServerPackFileId encontrado: ${fileInfo.serverPackFileId}`);
            serverFileId = fileInfo.serverPackFileId;
          } else {
            console.log(`[CurseForge] ServerPackFileId NAO existe, usando arquivo padrao`);
          }
        }
      } catch (e) {
        console.warn('[CurseForge] Falha ao verificar serverPackFileId:', e);
      }

      const fileRes = await fetch(`https://api.curseforge.com/v1/mods/${modId}/files/${serverFileId}`, {
        headers: { 'x-api-key': cfKey }
      });
      if (fileRes.ok) {
        const fileData = await fileRes.json() as any;
        const file = fileData.data;
        versionName = file.displayName || serverFileId;
        
        // Melhor extração da versão do Minecraft (evita pegar "Forge" ou "Fabric")
        const mcVerObj = file.sortableGameVersions?.find((v: any) => v.gameVersionName && v.gameVersionName.match(/^1\.\d+/));
        if (mcVerObj) {
          minecraftVersion = mcVerObj.gameVersionName;
        } else {
          minecraftVersion = file.gameVersions?.find((v: string) => v.match(/^1\.\d+/)) || file.gameVersions?.[0] || 'unknown';
        }
        
        const rawLoader = file.sortableGameVersions?.find((v: any) => ['Forge', 'Fabric', 'NeoForge', 'Quilt'].includes(v.gameVersionName))?.gameVersionName || 'Forge';
        loader = ['Forge', 'Fabric', 'NeoForge', 'Quilt'].includes(rawLoader) ? rawLoader : 'Forge';
        loaderVersion = rawLoader;
        // CurseForge nem sempre retorna downloadUrl, tenta endpoint /download
        if (file.downloadUrl) {
          downloadUrl = file.downloadUrl;
        } else {
          // Busca URL de download via endpoint específico
          try {
            const downloadRes = await fetch(`https://api.curseforge.com/v1/mods/${modId}/files/${serverFileId}/download`, {
              headers: { 'x-api-key': cfKey }
            });
            if (downloadRes.ok) {
              const downloadData = await downloadRes.json() as any;
              downloadUrl = downloadData.data?.url || '';
            }
          } catch (e) {
            console.warn('[CurseForge] Falha ao buscar URL de download:', e);
          }
          // Fallback manual se a API também não retornar
          if (!downloadUrl && file.id && file.fileName) {
            const idStr = String(file.id);
            const part1 = idStr.substring(0, idStr.length - 3) || '0';
            const part2 = idStr.substring(idStr.length - 3).padStart(3, '0');
            downloadUrl = `https://edge.forgecdn.net/files/${part1}/${part2}/${file.fileName}`;
          }
        }
        fileSize = String(file.fileLength || 0);
        releasedAt = new Date(file.fileDate) || new Date();
        console.log(`[CurseForge] Download URL: ${downloadUrl || 'VAZIO'}`);
      } else {
        const errorText = await fileRes.text();
        console.error(`[CurseForge] Erro ao buscar arquivo ${serverFileId}: ${fileRes.status} - ${errorText}`);
        return res.status(400).json({ message: `Erro ao buscar arquivo do modpack: ${fileRes.status}` });
      }
    }

    if (!downloadUrl) {
      return res.status(400).json({ message: 'Não foi possível obter URL de download da versão' });
    }

    // Gerar slug a partir do nome
    const modpackSlug = modpackName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Criar ou atualizar modpack no banco
    let modpack = await prisma.modpack.findFirst({
      where: { name: modpackName }
    });

    if (!modpack) {
      modpack = await prisma.modpack.create({
        data: {
          name: modpackName,
          slug: modpackSlug,
          description: modpackDescription,
          icon: modpackIcon,
          source: provider,
          source_id: modpack_slug,
          minecraft_version: minecraftVersion,
          modloader: loader,
          is_active: 1
        }
      });
    } else {
      modpack = await prisma.modpack.update({
        where: { id: modpack.id },
        data: {
          description: modpackDescription,
          icon: modpackIcon,
          minecraft_version: minecraftVersion,
          modloader: loader
        }
      });
    }

    // Criar ou atualizar versão no banco
    let modpackVersion = await prisma.modpackVersion.findFirst({
      where: {
        modpack_id: modpack.id,
        version: versionName
      }
    });

    if (!modpackVersion) {
      modpackVersion = await prisma.modpackVersion.create({
        data: {
          modpack_id: modpack.id,
          version: versionName,
          download_url: downloadUrl,
          file_size: fileSize ? BigInt(fileSize) : null,
          is_recommended: 1
        }
      });
    } else {
      modpackVersion = await prisma.modpackVersion.update({
        where: { id: modpackVersion.id },
        data: {
          download_url: downloadUrl,
          file_size: fileSize ? BigInt(fileSize) : null,
          is_recommended: 1
        }
      });
    }

    // Limpa instalação anterior se delete_files = true
    if (delete_files) {
      await prisma.serverModpack.deleteMany({
        where: { server_id: serverId }
      });
    }

    const shouldDelete = delete_files === true || delete_files === 'true' || delete_files === 1 || delete_files === '1';
    const result = await installModpack(serverId, String(modpack.id), String(modpackVersion.id), 'install', shouldDelete);
    res.json({ success: true, message: 'Instalação iniciada', jobId: result.jobId });
  } catch (error: any) {
    console.error('[Modpack Installer] Erro ao instalar modpack:', error);
    res.status(500).json({ message: 'Erro ao instalar modpack', error: error?.message || String(error) });
  }
});

// Desinstala o modpack do servidor
router.delete('/:id/modpack/uninstall', async (req, res) => {
  try {
    const serverId = req.params.id;
    await uninstallModpack(serverId);
    res.json({ success: true, message: 'Modpack desinstalado com sucesso' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao desinstalar modpack', error });
  }
});

// Retorna metadados do modpack instalado (lido do arquivo .modpack_metadata.json)
router.get('/:id/modpack/metadata', async (req, res) => {
  try {
    const serverId = req.params.id;
    const serverDir = `/var/lib/pterodactyl/volumes/${serverId}`;
    const metadataPath = `${serverDir}/.modpack_metadata.json`;
    
    const { promises: fsP } = require('fs');
    try {
      const content = await fsP.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(content);
      
      // Patch para garantir que o ID retornado seja o source_id (CurseForge ID/Modrinth slug)
      // pois versões antigas salvavam o ID do banco de dados
      const serverModpack = await prisma.serverModpack.findFirst({
        where: { server_id: serverId }
      });
      if (serverModpack) {
        const dbModpack = await prisma.modpack.findUnique({
          where: { id: serverModpack.modpack_id }
        });
        if (dbModpack?.source_id) {
          metadata.id = dbModpack.source_id;
        }
        
        // Inject versionId for accurate update checks
        const dbVersion = await prisma.modpackVersion.findUnique({
          where: { id: serverModpack.modpack_version_id }
        });
        if (dbVersion) {
          metadata.versionId = String(dbVersion.version_id || dbVersion.id || '');
        }
      }
      
      res.json(metadata);
    } catch {
      // Also try to build metadata from DB
      const serverModpack = await prisma.serverModpack.findFirst({
        where: { server_id: serverId }
      });
      if (serverModpack) {
        const modpack = await prisma.modpack.findUnique({
          where: { id: serverModpack.modpack_id }
        });
        const version = await prisma.modpackVersion.findUnique({
          where: { id: serverModpack.modpack_version_id }
        });
        if (modpack) {
          res.json({
            id: modpack.source_id || String(modpack.id),
            name: modpack.name,
            version: version?.version || 'unknown',
            versionId: String(version?.version_id || version?.id || ''),
            provider: modpack.source || 'unknown',
            loader: modpack.modloader || '',
            minecraftVersion: modpack.minecraft_version || '',
            icon: modpack.icon || '',
            description: modpack.description || '',
            installedAt: serverModpack.installed_at?.toISOString() || new Date().toISOString()
          });
          return;
        }
      }
      res.status(404).json({ message: 'Nenhum modpack instalado' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar metadados', error });
  }
});

// Retorna as versões disponíveis para o modpack instalado
router.get('/:id/modpack/versions', async (req, res) => {
  try {
    const serverModpack = await prisma.serverModpack.findFirst({
      where: { server_id: req.params.id }
    });
    if (!serverModpack) return res.status(404).json({ message: 'Nenhum modpack instalado' });
    
    const modpack = await prisma.modpack.findUnique({
      where: { id: serverModpack.modpack_id }
    });
    if (!modpack) return res.status(404).json({ message: 'Modpack não encontrado no banco' });
    
    const sourceId = modpack.source_id || String(modpack.id);
    
    if ((modpack.source || '').toLowerCase() === 'modrinth') {
      const resp = await fetch(`https://api.modrinth.com/v2/project/${sourceId}/version`);
      if (!resp.ok) return res.status(400).json({ message: 'Erro Modrinth' });
      const data = await resp.json() as any[];
      return res.json(data.map((v: any) => ({
        id: v.id,
        name: v.name || v.version_number,
        game_versions: v.game_versions
      })));
    } else {
      const cfKey = await getCurseForgeKey();
      if (!cfKey) return res.status(400).json({ message: 'Chave CurseForge não configurada no painel' });
      
      let finalModId = sourceId;
      // Se o source_id não for número (ex: "stoneblock"), buscamos o ID real na API do CurseForge
      if (!/^\d+$/.test(finalModId)) {
        const searchRes = await fetch(`https://api.curseforge.com/v1/mods/search?gameId=432&slug=${finalModId}`, {
          headers: { 'x-api-key': cfKey, 'Accept': 'application/json' }
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json() as any;
          if (searchData.data && searchData.data.length > 0) {
            finalModId = String(searchData.data[0].id);
          } else {
            return res.status(404).json({ message: `Modpack não encontrado na busca: ${finalModId}` });
          }
        } else {
          return res.status(400).json({ message: `Erro na busca do CurseForge: ${await searchRes.text()}` });
        }
      }

      const resp = await fetch(`https://api.curseforge.com/v1/mods/${finalModId}/files?pageSize=50`, {
        headers: { 'x-api-key': cfKey, 'Accept': 'application/json' }
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        return res.status(400).json({ message: `Erro CurseForge (${resp.status}): ${text}` });
      }
      const data = await resp.json() as any;
      return res.json(data.data.map((f: any) => ({
        id: String(f.id),
        name: f.displayName || f.fileName,
        game_versions: f.gameVersions,
        isServerPack: !!f.serverPackFileId
      })));
    }
  } catch (err: any) {
    res.status(500).json({ message: 'Erro interno', error: err.message });
  }
});

export default router;
