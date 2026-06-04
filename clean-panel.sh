#!/bin/bash

echo "Iniciando limpeza completa dos addons quebrados..."

cd /var/www/pterodactyl || cd /var/www/jexactyl || exit 1

# ============================================================
# 1. Remover pastas de addons quebrados
# ============================================================
rm -rf resources/scripts/components/server/mcmodpacks
rm -rf resources/scripts/components/server/mcplugins
rm -rf resources/scripts/api/server/mcmodpacks
rm -rf resources/scripts/api/server/mcplugins
rm -rf resources/scripts/components/server/playermanager
rm -rf resources/scripts/api/server/playermanager
rm -rf resources/scripts/components/server/modpacks
rm -rf resources/scripts/blueprints/modpack-installer
echo "✓ Pastas dos addons deletadas."

# ============================================================
# 2. Script Node.js para limpeza fina
# ============================================================
{
cat << 'CLEANEOF'
const fs = require('fs');
const path = require('path');
const panelDir = process.cwd();
const filesToFix = [
    'resources/scripts/components/NavigationBar.tsx',
    'resources/scripts/routers/ServerElements.tsx',
];
filesToFix.forEach(file => {
    const fullPath = path.join(panelDir, file);
    if (!fs.existsSync(fullPath)) return;
    let c = fs.readFileSync(fullPath, 'utf8');
    c = c.replace(/\/\/ @ts-nocheck\n?/g, '');
    if (!c.includes('eslint-disable')) c = '/* eslint-disable */\n' + c;
    c = c.replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(fullPath, c);
    console.log('Corrigido: ' + file);
});
const crlf = [
    'resources/scripts/components/elements/PaginationBagou.tsx',
    'resources/scripts/components/server/console/ConsoleBlock.tsx',
    'resources/scripts/components/server/files/NewDirectoryDialog.tsx',
];
crlf.forEach(file => {
    const fullPath = path.join(panelDir, file);
    if (!fs.existsSync(fullPath)) return;
    let c = fs.readFileSync(fullPath, 'utf8');
    if (c.includes('\r')) {
        c = c.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (!c.includes('eslint-disable')) c = '/* eslint-disable */\n' + c;
        fs.writeFileSync(fullPath, c);
    }
});
(function cleanServerRouter() {
    const p = path.join(panelDir, 'resources/scripts/routers/ServerRouter.tsx');
    if (!fs.existsSync(p)) return;
    let c = fs.readFileSync(p, 'utf8');
    c = c.replace(/import ModpacksPage from '[^']+';?\n?/g, '');
    c = c.replace(/import ModpacksPage from "[^"]+";?\n?/g, '');
    c = c.replace(/<Route path=\{\$\{match\.(url|path)\}\/modpacks\}[^>]*>[\s\S]*?<\/Route>\n?/g, '');
    c = c.replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(p, c);
    console.log('ServerRouter.tsx limpo.');
})();
(function cleanRoutesTs() {
    const p = path.join(panelDir, 'resources/scripts/routers/routes.ts');
    if (!fs.existsSync(p)) return;
    let c = fs.readFileSync(p, 'utf8');
    c = c.replace(/\{[^}]*path:\s*'\/modpacks'[^}]*\},?\n?/gs, '');
    c = c.replace(/import ModpacksPage from '[^']+';?\n?/g, '');
    c = c.replace(/import ModpacksPage from "[^"]+";?\n?/g, '');
    c = c.replace(/,\s*,/g, ',');
    c = c.replace(/,(\s*\])/g, '\n]');
    c = c.replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(p, c);
    console.log('routes.ts limpo.');
})();
(function cleanServerElements() {
    const p = path.join(panelDir, 'resources/scripts/routers/ServerElements.tsx');
    if (!fs.existsSync(p)) return;
    let c = fs.readFileSync(p, 'utf8');
    c = c.replace(/\/\/ @ts-nocheck\n?/g, '');
    c = c.replace(/<NavLink[^>]*\/modpacks[^>]*>[\s\S]*?<\/NavLink>/g, '');
    c = c.replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(p, c);
    console.log('ServerElements.tsx limpo.');
})();
CLEANEOF
} > /tmp/clean_addons.js

node /tmp/clean_addons.js
rm -f /tmp/clean_addons.js

echo "Limpeza concluída! Agora rode o install-vps.sh para reinstalar e compilar."
