"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const modpacks_1 = __importDefault(require("./routes/modpacks"));
const serverModpacks_1 = __importDefault(require("./routes/serverModpacks"));
const adminSettings_1 = __importDefault(require("./routes/adminSettings"));
// Patch global de serialização de BigInt para Express/JSON.stringify
BigInt.prototype.toJSON = function () {
    return Number(this);
};
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
exports.prisma = prisma;
app.use(express_1.default.json());
// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'modpack-installer' });
});
// Register routes
app.use('/api/modpacks', modpacks_1.default);
app.use('/api/client/servers', serverModpacks_1.default);
app.use('/api/admin', adminSettings_1.default);
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`[Modpack Installer] Backend rodando na porta ${PORT}`);
});
//# sourceMappingURL=standalone.js.map