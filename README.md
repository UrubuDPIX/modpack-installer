# Modpack Installer - Jexactyl Blueprint

Addon para painel Jexactyl/Pterodactyl que permite instalar, atualizar e gerenciar modpacks Minecraft em servidores com integração direta à API do Modrinth.

## Funcionalidades

- Busca e instalação de modpacks do Modrinth com um clique
- Cards compactos em grid responsivo
- Filtros por categoria, loader (Forge/Fabric/NeoForge/Quilt) e versão do Minecraft
- Ordenação por relevância, downloads, popularidade e data
- Suporte a múltiplas versões (update/downgrade/reinstall)
- Backup automático do mundo durante instalações
- Sistema de permissões granular
- Design integrado ao tema dark do Jexactyl

## Instalação Rápida (One-Liner)

### VPS / Servidor Linux (Ubuntu/Debian)

```bash
# One-liner - baixa e instala automaticamente
curl -sSL https://raw.githubusercontent.com/SEU-USUARIO/modpack-installer/main/install-vps.sh | sudo bash

# Ou baixe primeiro e execute
curl -sSL https://raw.githubusercontent.com/SEU-USUARIO/modpack-installer/main/install-vps.sh -o install.sh
chmod +x install.sh
sudo bash install.sh
```

### Docker (Windows/Linux)

```bash
# Clone o repositório
git clone https://github.com/SEU-USUARIO/modpack-installer.git
cd modpack-installer

# Execute o script Docker
chmod +x install-docker.sh
bash install-docker.sh
```

### Windows (PowerShell)

```powershell
# Execute como Administrador
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/SEU-USUARIO/modpack-installer/main/install-windows.ps1" -OutFile "install.ps1"
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\install.ps1
```

## Instalação Manual

1. Clone este repositório:
   ```bash
   git clone https://github.com/SEU-USUARIO/modpack-installer.git
   cd modpack-installer
   ```

2. Execute o script de instalação:
   ```bash
   sudo bash install-vps.sh
   ```

3. O script irá:
   - Detectar automaticamente o diretório do Jexactyl
   - Copiar os arquivos do blueprint
   - Criar as tabelas no banco de dados
   - Registrar as permissões
   - Compilar os assets do frontend
   - Reiniciar os serviços

## Requisitos

- Jexactyl ou Pterodactyl já instalado
- PHP 8.1+
- MySQL/MariaDB
- Node.js 18+ e Yarn
- Composer
- Git

## Permissões

O blueprint cria as seguintes permissões:

- `modpacks.view` - Visualizar o instalador de modpacks
- `modpacks.install` - Instalar e reinstalar modpacks
- `modpacks.downgrade` - Fazer downgrade de modpacks

## Estrutura

```
modpack-installer/
├── blueprint.json          # Configuração do addon
├── client/                 # Frontend React
│   ├── components/         # Componentes UI
│   ├── pages/             # Páginas
│   ├── types/             # Tipos TypeScript
│   └── styles.css         # Estilos
├── server/                # Backend
│   ├── routes/            # Rotas API
│   └── services/          # Serviços
├── database/              # Migrações
└── prisma/                # Schema
```

## API Endpoints

- `GET /api/modpacks` - Lista modpacks
- `GET /api/servers/:id/modpack` - Modpack do servidor
- `POST /api/servers/:id/modpack/install` - Instalar
- `DELETE /api/servers/:id/modpack/uninstall` - Desinstalar

## Licença

MIT
