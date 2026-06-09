"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
exports.default = modpackInstallerAddon;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const modpacks_1 = __importDefault(require("./routes/modpacks"));
const serverModpacks_1 = __importDefault(require("./routes/serverModpacks"));
const adminSettings_1 = __importDefault(require("./routes/adminSettings"));
// Patch global de serialização de BigInt para Express/JSON.stringify
BigInt.prototype.toJSON = function () {
    return Number(this);
};
const prisma = new client_1.PrismaClient();
exports.prisma = prisma;
const router = (0, express_1.Router)();
function modpackInstallerAddon(app) {
    // Registra rotas
    app.use('/api/modpacks', modpacks_1.default);
    app.use('/api/client/servers', serverModpacks_1.default);
    app.use('/api/admin', adminSettings_1.default);
    // Inicialização
    console.log('[Modpack Installer] Addon carregado com sucesso');
}
//# sourceMappingURL=index.js.map