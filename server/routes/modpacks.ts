import { Router } from 'express';
import { prisma } from '../index';

const router = Router();

// Lista todos os modpacks disponíveis
router.get('/', async (req, res) => {
  try {
    const modpacks = await prisma.modpack.findMany({
      include: {
        versions: {
          orderBy: { releasedAt: 'desc' }
        }
      }
    });
    res.json(modpacks);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar modpacks', error });
  }
});

// Busca um modpack específico
router.get('/:id', async (req, res) => {
  try {
    const modpack = await prisma.modpack.findUnique({
      where: { id: req.params.id },
      include: {
        versions: {
          orderBy: { releasedAt: 'desc' }
        }
      }
    });

    if (!modpack) {
      return res.status(404).json({ message: 'Modpack não encontrado' });
    }

    res.json(modpack);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar modpack', error });
  }
});

export default router;
