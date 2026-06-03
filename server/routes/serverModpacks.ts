import { Router } from 'express';
import { prisma } from '../index';
import { installModpack, uninstallModpack } from '../services/installer';

const router = Router({ mergeParams: true });

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
router.post('/:id/modpack/install', async (req, res) => {
  try {
    const { modpackId, versionId, action } = req.body;
    const serverId = req.params.id;

    const result = await installModpack(serverId, modpackId, versionId, action);
    res.json({ success: true, message: 'Instalação iniciada', jobId: result.jobId });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao instalar modpack', error });
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
