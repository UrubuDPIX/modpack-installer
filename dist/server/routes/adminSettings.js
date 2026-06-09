"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const router = (0, express_1.Router)();
// GET /api/admin/modpack-settings
router.get('/modpack-settings', async (req, res) => {
    try {
        const settings = await index_1.prisma.$queryRaw `
      SELECT * FROM modpack_settings
    `;
        const result = {
            curseforge_api_key: '',
            modrinth_enabled: true,
            curseforge_enabled: false,
            default_loader: 'forge'
        };
        settings.forEach((row) => {
            if (row.key === 'modrinth_enabled' || row.key === 'curseforge_enabled') {
                result[row.key] = row.value === '1' || row.value === 'true';
            }
            else if (row.key === 'curseforge_api_key') {
                result[row.key] = row.value || '';
            }
            else {
                result[row.key] = row.value;
            }
        });
        res.json(result);
    }
    catch (error) {
        console.error('[Modpack Settings] Erro ao buscar:', error);
        res.status(500).json({ message: 'Erro ao carregar configuracoes' });
    }
});
// POST /api/admin/modpack-settings
router.post('/modpack-settings', async (req, res) => {
    try {
        const { curseforge_api_key, modrinth_enabled, curseforge_enabled, default_loader } = req.body;
        const updates = [
            { key: 'curseforge_api_key', value: curseforge_api_key || '' },
            { key: 'modrinth_enabled', value: modrinth_enabled ? '1' : '0' },
            { key: 'curseforge_enabled', value: curseforge_enabled ? '1' : '0' },
            { key: 'default_loader', value: default_loader || 'forge' }
        ];
        for (const item of updates) {
            await index_1.prisma.$executeRaw `
        INSERT INTO modpack_settings (key, value) 
        VALUES (${item.key}, ${item.value})
        ON DUPLICATE KEY UPDATE value = ${item.value}
      `;
        }
        res.json({ success: true, message: 'Configuracoes salvas' });
    }
    catch (error) {
        console.error('[Modpack Settings] Erro ao salvar:', error);
        res.status(500).json({ message: 'Erro ao salvar configuracoes' });
    }
});
exports.default = router;
//# sourceMappingURL=adminSettings.js.map