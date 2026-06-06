import { Router } from 'express';
import { prisma } from '../index';
import { installModpack, uninstallModpack } from '../services/installer';

const router = Router({ mergeParams: true });

async function getCurseForgeKey(): Promise<string | null> {
  try {
    const result: any = await prisma.$queryRaw`SELECT value FROM modpack_settings WHERE \`key\` = 'curseforge_api_key' LIMIT 1`;
    return result?.[0]?.value || null;
  } catch {
    return null;
  }
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
      // Buscar mod
      const modRes = await fetch(`https://api.curseforge.com/v1/mods/${modpack_slug}`, {
        headers: { 'x-api-key': cfKey }
      });
      if (modRes.ok) {
        const modData = await modRes.json() as any;
        const mod = modData.data;
        modpackName = mod.name || modpack_slug;
        modpackAuthor = mod.authors?.[0]?.name || 'unknown';
        modpackDescription = mod.summary || '';
        modpackIcon = mod.logo?.url || '';
        modpackDownloads = mod.downloadCount || 0;
      } else {
        const errorText = await modRes.text();
        console.error(`[CurseForge] Erro ao buscar mod ${modpack_slug}: ${modRes.status} - ${errorText}`);
        return res.status(400).json({ message: `Erro ao buscar modpack na CurseForge: ${modRes.status}` });
      }
      // Buscar arquivo (version_id é o fileId)
      const fileRes = await fetch(`https://api.curseforge.com/v1/mods/${modpack_slug}/files/${version_id}`, {
        headers: { 'x-api-key': cfKey }
      });
      if (fileRes.ok) {
        const fileData = await fileRes.json() as any;
        const file = fileData.data;
        versionName = file.displayName || version_id;
        minecraftVersion = file.gameVersions?.[0] || 'unknown';
        const rawLoader = file.sortableGameVersions?.find((v: any) => ['Forge', 'Fabric', 'NeoForge', 'Quilt'].includes(v.gameVersionName))?.gameVersionName || 'Forge';
        loader = ['Forge', 'Fabric', 'NeoForge', 'Quilt'].includes(rawLoader) ? rawLoader : 'Forge';
        loaderVersion = rawLoader;
        // CurseForge nem sempre retorna downloadUrl, tenta fallback
        if (file.downloadUrl) {
          downloadUrl = file.downloadUrl;
        } else if (file.id && file.fileName) {
          const idStr = String(file.id);
          const part1 = idStr.substring(0, idStr.length - 3) || '0';
          const part2 = idStr.substring(idStr.length - 3).padStart(3, '0');
          downloadUrl = `https://edge.forgecdn.net/files/${part1}/${part2}/${file.fileName}`;
        }
        fileSize = String(file.fileLength || 0);
        releasedAt = new Date(file.fileDate) || new Date();
        console.log(`[CurseForge] Download URL: ${downloadUrl || 'VAZIO'}`);
      } else {
        const errorText = await fileRes.text();
        console.error(`[CurseForge] Erro ao buscar arquivo ${version_id}: ${fileRes.status} - ${errorText}`);
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

    const result = await installModpack(serverId, String(modpack.id), String(modpackVersion.id), 'install');
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

export default router;
