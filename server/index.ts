import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import modpackRoutes from './routes/modpacks';
import serverModpackRoutes from './routes/serverModpacks';

const prisma = new PrismaClient();
const router = Router();

export default function modpackInstallerAddon(app: any) {
  // Registra rotas
  app.use('/api/modpacks', modpackRoutes);
  app.use('/api/servers', serverModpackRoutes);

  // Inicialização
  console.log('[Modpack Installer] Addon carregado com sucesso');
}

export { prisma };
