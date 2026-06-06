import express from 'express';
import { PrismaClient } from '@prisma/client';
import modpackRoutes from './routes/modpacks';
import serverModpackRoutes from './routes/serverModpacks';
import adminSettingsRoutes from './routes/adminSettings';

// Patch global de serialização de BigInt para Express/JSON.stringify
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'modpack-installer' });
});

// Register routes
app.use('/api/modpacks', modpackRoutes);
app.use('/api/client/servers', serverModpackRoutes);
app.use('/api/admin', adminSettingsRoutes);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`[Modpack Installer] Backend rodando na porta ${PORT}`);
});

export { prisma };
