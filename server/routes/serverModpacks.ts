import { Router } from 'express';
import { prisma } from '../index';
import { installModpack, uninstallModpack } from '../services/installer';

const router = Router({ mergeParams: true });

async function getCurseForgeKey(): Promise<string | null> {
  try {
    const result: any = await prisma.$queryRaw`SELECT value FROM modpack_settings WHERE key = 'curseforge_api_key' LIMIT 1`;
    return result?.[0]?.value || null;
  } catch {
    return null;
  }
}

// Busca modpack instalado no servidor
router.get('/:id/modpack', async (req, res) => {
  try {
    const serverModpack = await prisma.serverModpack.findFirst({
      where: { serverId: req.params.id },
      include: {
        modpack: {
          include: { versions: true }
        },
        version: true
      }
    });

    if (!serverModpack) {
      return res.status(404).json({ message: 'Nenhum modpack instalado' });
    }

    res.json(serverModpack);
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
      if (projectRes.ok) {
        const project = await projectRes.json() as any;
        modpackName = project.title || modpack_slug;
        modpackAuthor = project.author || project.team || 'unknown';
        modpackDescription = project.description || '';
        modpackIcon = project.icon_url || '';
        modpackDownloads = project.downloads || 0;
      }
      // Buscar versão
      const verRes = await fetch(`https://api.modrinth.com/v2/version/${version_id}`);
      if (verRes.ok) {
        const ver = await verRes.json() as any;
        versionName = ver.name || version_id;
        minecraftVersion = ver.game_versions?.[0] || 'unknown';
        const rawLoader = ver.loaders?.[0] || 'Forge';
        loader = ['Forge', 'Fabric', 'NeoForge', 'Quilt'].includes(rawLoader) ? rawLoader : 'Forge';
        loaderVersion = ver.loaders?.[0] || 'unknown';
        downloadUrl = ver.files?.[0]?.url || '';
        fileSize = String(ver.files?.[0]?.size || 0);
        releasedAt = new Date(ver.date_published) || new Date();
      }
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
        downloadUrl = file.downloadUrl || `https://edge.forgecdn.net/files/${Math.floor(file.id / 1000)}/${file.id % 1000}/${file.fileName}`;
        fileSize = String(file.fileLength || 0);
        releasedAt = new Date(file.fileDate) || new Date();
      }
    }

    if (!downloadUrl) {
      return res.status(400).json({ message: 'Não foi possível obter URL de download da versão' });
    }

    // Criar ou atualizar modpack no banco
    let modpack = await prisma.modpack.findFirst({
      where: { name: modpackName }
    });

    if (!modpack) {
      modpack = await prisma.modpack.create({
        data: {
          name: modpackName,
          author: modpackAuthor,
          description: modpackDescription,
          icon: modpackIcon,
          downloads: modpackDownloads
        }
      });
    } else {
      modpack = await prisma.modpack.update({
        where: { id: modpack.id },
        data: {
          author: modpackAuthor,
          description: modpackDescription,
          icon: modpackIcon,
          downloads: modpackDownloads
        }
      });
    }

    // Criar ou atualizar versão no banco
    let modpackVersion = await prisma.modpackVersion.findFirst({
      where: {
        modpackId: modpack.id,
        name: versionName
      }
    });

    if (!modpackVersion) {
      modpackVersion = await prisma.modpackVersion.create({
        data: {
          modpackId: modpack.id,
          name: versionName,
          minecraftVersion,
          loader,
          loaderVersion,
          size: fileSize,
          downloadUrl,
          releasedAt
        }
      });
    } else {
      modpackVersion = await prisma.modpackVersion.update({
        where: { id: modpackVersion.id },
        data: {
          minecraftVersion,
          loader,
          loaderVersion,
          size: fileSize,
          downloadUrl,
          releasedAt
        }
      });
    }

    // Limpa instalação anterior se delete_files = true
    if (delete_files) {
      await prisma.serverModpack.deleteMany({
        where: { serverId }
      });
    }

    const result = await installModpack(serverId, modpack.id, modpackVersion.id, 'install');
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
