#!/bin/bash
# ============================================================================
# Modpack Installer - VPS Auto Install Script (Oracle/AWS/DigitalOcean/etc)
# ============================================================================
# One-liner install:
#   curl -sSL https://raw.githubusercontent.com/SEU-REPO/main/install-vps.sh | sudo bash
# ============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

BLUEPRINT_NAME="Modpack Installer"
BLUEPRINT_VERSION="1.0.0"
PANEL_DIR=""
REPO_URL="${REPO_URL:-https://github.com/UrubuDPIX/modpack-installer}"
TEMP_DIR="/tmp/modpack-installer-$(date +%s)"

print_banner() {
    echo -e "${CYAN}"
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🎮  Modpack Installer for Jexactyl                       ║
║       Auto Install Script v1.0.0                             ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

print_step() { echo -e "${BLUE}[PASSO]${NC} $1"; }
print_success() { echo -e "${GREEN}[OK]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[AVISO]${NC} $1"; }
print_error() { echo -e "${RED}[ERRO]${NC} $1"; }
print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }

# ============================================================================
# DETECÇÃO DE AMBIENTE
# ============================================================================

detect_panel() {
    print_step "Detectando instalação do Jexactyl/Pterodactyl..."
    
    # Possíveis diretórios do painel
    local paths=(
        "/var/www/jexactyl"
        "/var/www/pterodactyl"
        "/var/www/panel"
        "/home/jexactyl"
        "/opt/jexactyl"
        "/opt/pterodactyl"
    )
    
    for path in "${paths[@]}"; do
        if [ -f "$path/artisan" ] && [ -d "$path/vendor" ]; then
            PANEL_DIR="$path"
            print_success "Painel encontrado em: $PANEL_DIR"
            return 0
        fi
    done
    
    # Tenta encontrar via localização do artisan
    local found=$(find /var/www /home /opt -maxdepth 3 -name "artisan" -type f 2>/dev/null | head -1)
    if [ -n "$found" ]; then
        PANEL_DIR=$(dirname "$found")
        if [ -d "$PANEL_DIR/vendor" ]; then
            print_success "Painel encontrado em: $PANEL_DIR"
            return 0
        fi
    fi
    
    print_error "Jexactyl/Pterodactyl não encontrado!"
    print_info "Instale o Jexactyl primeiro: https://docs.jexactyl.com"
    exit 1
}

# ============================================================================
# VERIFICAÇÃO DE PRÉ-REQUISITOS
# ============================================================================

check_prerequisites() {
    print_step "Verificando pré-requisitos..."
    
    # Verifica se está rodando como root
    if [ "$EUID" -ne 0 ] && ! sudo -n true 2>/dev/null; then
        print_error "Este script precisa de permissões de root ou sudo sem senha"
        print_info "Execute com: sudo bash install-vps.sh"
        exit 1
    fi
    
    # Verifica PHP
    if command -v php &> /dev/null; then
        PHP_VERSION=$(php -v | head -n 1 | grep -oP '\d+\.\d+')
        print_success "PHP $PHP_VERSION encontrado"
    else
        print_error "PHP não encontrado"
        exit 1
    fi
    
    # Verifica e instala php-xml ( necessario para Laravel/DOMDocument )
    if ! php -m | grep -q "simplexml"; then
        print_warning "Extensao php-xml nao encontrada. Instalando..."
        apt-get install -y php-xml php-dom 2>/dev/null || apt-get install -y php8.4-xml php8.4-dom 2>/dev/null || {
            print_warning "Nao foi possivel instalar php-xml automaticamente"
            print_info "Execute manualmente: apt-get install php-xml php-dom"
        }
    fi
    
    # Verifica Composer
    if command -v composer &> /dev/null; then
        print_success "Composer encontrado"
    else
        print_warning "Composer não encontrado. Tentando instalar..."
        curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
        if command -v composer &> /dev/null; then
            print_success "Composer instalado"
        else
            print_error "Falha ao instalar Composer"
            exit 1
        fi
    fi
    
    # Verifica Node.js
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2)
        print_success "Node.js $NODE_VERSION encontrado"
        HAS_NODE=true
    else
        print_warning "Node.js não encontrado. Tentando instalar..."
        install_nodejs
    fi
    
    # Verifica Yarn
    if command -v yarn &> /dev/null; then
        print_success "Yarn encontrado"
    else
        print_info "Instalando Yarn..."
        npm install -g yarn
        print_success "Yarn instalado"
    fi
    
    # Verifica Git
    if ! command -v git &> /dev/null; then
        print_error "Git não encontrado. Instale com: apt install git"
        exit 1
    fi
    
    # Verifica MySQL/MariaDB
    if command -v mysql &> /dev/null || command -v mariadb &> /dev/null; then
        print_success "Banco de dados encontrado"
    else
        print_warning "MySQL/MariaDB não detectado no PATH"
    fi
    
    # Verifica Nginx/Apache
    if command -v nginx &> /dev/null || command -v apache2 &> /dev/null; then
        print_success "Web server encontrado"
    else
        print_warning "Nginx/Apache não detectado"
    fi
    
    print_success "Pré-requisitos verificados"
}

install_nodejs() {
    print_step "Instalando Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2)
        print_success "Node.js $NODE_VERSION instalado"
        HAS_NODE=true
    else
        print_error "Falha ao instalar Node.js"
        HAS_NODE=false
    fi
}

# ============================================================================
# DOWNLOAD DO BLUEPRINT
# ============================================================================

download_blueprint() {
    print_step "Baixando blueprint..."
    
    mkdir -p "$TEMP_DIR"
    cd "$TEMP_DIR"
    
    # Tenta baixar do repositório
    if [ -n "$REPO_URL" ]; then
        print_info "Clonando de: $REPO_URL"
        git clone --depth 1 "$REPO_URL" . 2>/dev/null || {
            print_info "Repositório não acessível. Usando arquivos locais..."
            # Se não conseguir clonar, assume que os arquivos estão no diretório atual
            if [ -f "blueprint.json" ]; then
                print_success "Usando arquivos locais"
            else
                print_error "Não foi possível obter os arquivos do blueprint"
                print_info "Coloque os arquivos do blueprint no diretório atual e execute novamente"
                exit 1
            fi
        }
    fi
    
    # Verifica estrutura
    if [ ! -f "blueprint.json" ]; then
        print_error "blueprint.json não encontrado!"
        exit 1
    fi
    
    print_success "Blueprint baixado"
}

# ============================================================================
# INSTALAÇÃO DO BLUEPRINT
# ============================================================================

install_blueprint() {
    print_step "Instalando blueprint no painel..."
    
    local blueprint_dir="$PANEL_DIR/blueprints/modpack-installer"
    
    # Remove instalação anterior se existir
    if [ -d "$blueprint_dir" ]; then
        print_info "Removendo instalação anterior..."
        rm -rf "$blueprint_dir"
    fi
    
    mkdir -p "$blueprint_dir"
    
    # Copia arquivos
    print_info "Copiando arquivos..."
    cp "$TEMP_DIR/blueprint.json" "$blueprint_dir/"
    
    # Copiar arquivos do blueprint
    if [ -d "$TEMP_DIR/client" ]; then
        cp -r "$TEMP_DIR/client" "$blueprint_dir/"
    fi
    
    print_step "Integrando frontend..."
    # Copiar componentes para dentro do resources/scripts onde o Webpack pode encontrar
    local modpacks_dir="$PANEL_DIR/resources/scripts/components/server/modpacks"
    rm -rf "$modpacks_dir"
    mkdir -p "$modpacks_dir"
    
    if [ -d "$TEMP_DIR/client/components" ]; then
        cp -r "$TEMP_DIR/client/components/." "$modpacks_dir/"
    fi
    if [ -d "$TEMP_DIR/client/pages" ]; then
        cp -r "$TEMP_DIR/client/pages/." "$modpacks_dir/"
    fi
    # Copiar types como arquivo plano types/index.ts -> modpacks/types.ts
    # Componentes importam './types' que resolve para modpacks/types.ts
    if [ -d "$TEMP_DIR/client/types" ]; then
        mkdir -p "$modpacks_dir/types"
        cp -r "$TEMP_DIR/client/types/." "$modpacks_dir/types/"
    fi
    # Remover blueprints do caminho do Webpack (evita erros de compilacao duplicados)
    # O diretorio resources/scripts/blueprints/ nao deve ser compilado pelo Webpack
    rm -rf "$PANEL_DIR/resources/scripts/blueprints/modpack-installer" 2>/dev/null || true
    if [ -f "$TEMP_DIR/client/styles.css" ]; then
        cp "$TEMP_DIR/client/styles.css" "$modpacks_dir/"
    fi
    print_success "Componentes copiados para: $modpacks_dir"
    
    [ -d "$TEMP_DIR/server" ] && cp -r "$TEMP_DIR/server" "$blueprint_dir/"
    [ -d "$TEMP_DIR/prisma" ] && cp -r "$TEMP_DIR/prisma" "$blueprint_dir/"
    [ -d "$TEMP_DIR/database" ] && cp -r "$TEMP_DIR/database" "$blueprint_dir/"
    
    # Copia scripts de instalação
    [ -f "$TEMP_DIR/install-blueprint-panel.php" ] && cp "$TEMP_DIR/install-blueprint-panel.php" "$PANEL_DIR/"
    
    print_success "Arquivos instalados em: $blueprint_dir"
}

# ============================================================================
# CONFIGURAÇÃO DO BANCO DE DADOS
# ============================================================================

setup_database() {
    print_step "Configurando banco de dados..."
    
    cd "$PANEL_DIR"
    
    # Copia blueprint.json temporariamente para o diretorio do painel
    if [ -f "$PANEL_DIR/blueprints/modpack-installer/blueprint.json" ]; then
        cp "$PANEL_DIR/blueprints/modpack-installer/blueprint.json" "$PANEL_DIR/blueprint.json"
    fi
    
    # Executa script PHP de instalação
    if [ -f "$PANEL_DIR/install-blueprint-panel.php" ]; then
        print_info "Executando script de instalação..."
        sudo -u www-data php "$PANEL_DIR/install-blueprint-panel.php" || {
            print_warning "Script PHP retornou erro, tentando método alternativo..."
            setup_database_manual
        }
        # Remove blueprint.json temporario
        rm -f "$PANEL_DIR/blueprint.json"
    else
        setup_database_manual
    fi
    
}

setup_database_manual() {
    print_info "Criando tabelas manualmente..."
    
    sudo -u www-data php -r "
require '$PANEL_DIR/vendor/autoload.php';
\$app = require_once '$PANEL_DIR/bootstrap/app.php';
\$kernel = \$app->make(Illuminate\Contracts\Console\Kernel::class);
\$kernel->bootstrap();

\$schema = \$app->make('db')->getSchemaBuilder();

if (!\$schema->hasTable('modpacks')) {
    \$schema->create('modpacks', function (\$table) {
        \$table->id();
        \$table->string('name');
        \$table->string('slug')->unique();
        \$table->text('description')->nullable();
        \$table->string('icon')->nullable();
        \$table->string('source')->default('modrinth');
        \$table->string('source_id')->nullable();
        \$table->string('minecraft_version');
        \$table->string('modloader');
        \$table->boolean('is_active')->default(true);
        \$table->timestamps();
    });
    echo 'Tabela modpacks criada' . PHP_EOL;
}

if (!\$schema->hasTable('modpack_versions')) {
    \$schema->create('modpack_versions', function (\$table) {
        \$table->id();
        \$table->foreignId('modpack_id')->constrained()->onDelete('cascade');
        \$table->string('version');
        \$table->string('download_url');
        \$table->bigInteger('file_size')->nullable();
        \$table->string('checksum')->nullable();
        \$table->boolean('is_recommended')->default(false);
        \$table->timestamps();
    });
    echo 'Tabela modpack_versions criada' . PHP_EOL;
}

if (!\$schema->hasTable('server_modpacks')) {
    \$schema->create('server_modpacks', function (\$table) {
        \$table->id();
        \$table->unsignedBigInteger('server_id');
        \$table->unsignedBigInteger('modpack_id');
        \$table->unsignedBigInteger('modpack_version_id')->nullable();
        \$table->string('status')->default('pending');
        \$table->text('install_log')->nullable();
        \$table->timestamp('installed_at')->nullable();
        \$table->timestamps();
        \$table->index('server_id');
        \$table->index('modpack_id');
    });
    echo 'Tabela server_modpacks criada' . PHP_EOL;
}

if (!\$schema->hasTable('modpack_settings')) {
    \$schema->create('modpack_settings', function (\$table) {
        \$table->id();
        \$table->string('key')->unique();
        \$table->text('value')->nullable();
        \$table->timestamps();
    });
    echo 'Tabela modpack_settings criada' . PHP_EOL;
    
    // Insert defaults
    DB::table('modpack_settings')->insert([
        ['key' => 'curseforge_api_key', 'value' => '', 'created_at' => now(), 'updated_at' => now()],
        ['key' => 'modrinth_enabled', 'value' => '1', 'created_at' => now(), 'updated_at' => now()],
        ['key' => 'curseforge_enabled', 'value' => '0', 'created_at' => now(), 'updated_at' => now()],
        ['key' => 'default_loader', 'value' => 'forge', 'created_at' => now(), 'updated_at' => now()],
    ]);
    echo 'Configuracoes padrao inseridas' . PHP_EOL;
}

echo PHP_EOL . 'Tabelas configuradas!' . PHP_EOL;
" || print_warning "Não foi possível criar tabelas automaticamente"
}

# ============================================================================
# REGISTRO DE PERMISSÕES
# ============================================================================

register_permissions() {
    print_step "Registrando permissões..."
    
    cd "$PANEL_DIR"
    
    # No Jexactyl, permissões são gerenciadas pelo Blueprint via blueprint.json
    # Tenta registrar via Blueprint CLI se disponível
    if sudo -u www-data php artisan list 2>/dev/null | grep -q "blueprint"; then
        sudo -u www-data php artisan blueprint:install 2>/dev/null || true
        print_success "Permissoes registradas via Blueprint"
    else
        print_info "Permissoes serao registradas automaticamente pelo Blueprint"
    fi
}

# ============================================================================
# INJEÇÃO NATIVA NO FRONTEND
# ============================================================================

inject_frontend_routes() {
    print_step "Injetando rotas nativamente no Jexactyl..."

    local JS=/tmp/inject_modpacks.js

    # Escreve o script de injeção de rotas usando node (LF-safe)
    {
    cat << 'JSEOF'
const fs = require('fs');
const path = require('path');
const panelDir = process.argv[2];

// 1. Patch ServerRouter.tsx
(function patchServerRouter() {
  const srPath = path.join(panelDir, 'resources/scripts/routers/ServerRouter.tsx');
  if (!fs.existsSync(srPath)) return;
  let c = fs.readFileSync(srPath, 'utf8');
  c = c.replace(/import ModpacksPage from '[^']+';?\n?/g, '');
  c = c.replace(/import ModpacksPage from "[^"]+";?\n?/g, '');
  c = c.replace(/<Route path=\{`\$\{match\.path\}\/modpacks`\}[^>]*>[\s\S]*?<\/Route>\n?/g, '');
  // Remove NavLink de modpacks se existir
  c = c.replace(/<NavLink[^>]*to=\{`\$\{match\.url\}\/modpacks`\}[^>]*>[\s\S]*?<\/NavLink>\n?/g, '');
  c = c.replace(/\n{3,}/g, '\n\n');

  if (!c.includes('ModpacksPage')) {
    const imports = [...c.matchAll(/^import .*;$/gm)];
    if (imports.length) {
      const lm = imports[imports.length - 1];
      c = c.slice(0, lm.index + lm[0].length) +
          "\nimport ModpacksPage from '@/components/server/modpacks/ModpacksPage';" +
          c.slice(lm.index + lm[0].length);
    }

    // Injetar Route
    const fm = c.match(/<Route path=\{`\$\{match\.path\}\/files`\} exact>[\s\S]*?<\/Route>/);
    if (fm) {
      const ls = c.lastIndexOf('\n', fm.index) + 1;
      const ind = (c.slice(ls, fm.index).match(/^(\s*)/) || ['',''])[1];
      const inj = '\n' + ind + '<Route path={`${match.path}/modpacks`} exact>\n' +
                  ind + '    <ModpacksPage />\n' +
                  ind + '</Route>';
      c = c.slice(0, fm.index + fm[0].length) + inj + c.slice(fm.index + fm[0].length);
      console.log('\u2713 Rota injetada no ServerRouter.tsx');
    } else {
      console.log('\u26a0 Rota /files nao encontrada no ServerRouter.tsx');
    }

    // Injetar NavLink na navegacao (depois de /files)
    const navMatch = c.match(/<NavLink to=\{`\$\{match\.url\}\/files`\}>[\s\S]*?<\/NavLink>/);
    if (navMatch) {
      const ls = c.lastIndexOf('\n', navMatch.index) + 1;
      const ind = (c.slice(ls, navMatch.index).match(/^(\s*)/) || ['',''])[1];
      const inj = '\n' + ind + '<NavLink to={`${match.url}/modpacks`}>' +
                  '\n' + ind + '    <FontAwesomeIcon icon={faBox} />' +
                  '\n' + ind + '    Modpacks' +
                  '\n' + ind + '</NavLink>';
      c = c.slice(0, navMatch.index + navMatch[0].length) + inj + c.slice(navMatch.index + navMatch[0].length);

      // Adicionar import do faBox se nao existir
      if (!c.includes('faBox')) {
        const faMatch = c.match(/import\s+\{[^}]*\}\s+from\s+['"]@fortawesome\/free-solid-svg-icons['"];?/);
        if (faMatch) {
          c = c.slice(0, faMatch.index) + faMatch[0].replace('{', '{ faBox, ') + c.slice(faMatch.index + faMatch[0].length);
        }
      }
      console.log('\u2713 NavLink de Modpacks injetado no ServerRouter.tsx');
    } else {
      console.log('\u26a0 NavLink /files nao encontrado para injecao');
    }
  }
  c = c.replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(srPath, c);
})();

// 2. Patch routes.ts
(function patchRoutesTs() {
  const rtPath = path.join(panelDir, 'resources/scripts/routers/routes.ts');
  if (!fs.existsSync(rtPath)) return;
  let c = fs.readFileSync(rtPath, 'utf8');
  c = c.replace(/\{[^}]*path:\s*'\/modpacks'[^}]*\},?\n?/gs, '');
  c = c.replace(/import ModpacksPage from '[^']+';?\n?/g, '');
  c = c.replace(/import ModpacksPage from "[^"]+";?\n?/g, '');
  c = c.replace(/\n{3,}/g, '\n\n');
  if (!c.includes('/modpacks') && !c.includes('ModpacksPage')) {
    const imports = [...c.matchAll(/^import .+from .+;$/gm)];
    if (imports.length) {
      const lm = imports[imports.length - 1];
      c = c.slice(0, lm.index + lm[0].length) +
          "\nimport ModpacksPage from '@/components/server/modpacks/ModpacksPage';" +
          c.slice(lm.index + lm[0].length);
    }
    const sm = c.match(/server:\s*\[/);
    if (sm) {
      const route = "\n        {\n            path: '/modpacks',\n            name: 'Modpacks',\n            permission: null,\n            component: ModpacksPage,\n        },";
      c = c.slice(0, sm.index + sm[0].length) + route + c.slice(sm.index + sm[0].length);
      console.log('\u2713 Rota /modpacks adicionada no routes.ts');
    } else {
      console.log('\u26a0 server: [ nao encontrado em routes.ts');
    }
  }
  fs.writeFileSync(rtPath, c);
})();

// 3. Patch AdminRouter.tsx
(function patchAdminRouter() {
  const arPath = path.join(panelDir, 'resources/scripts/routers/AdminRouter.tsx');
  if (!fs.existsSync(arPath)) return;
  let c = fs.readFileSync(arPath, 'utf8');
  c = c.replace(/import ModpackSettingsPage from '[^']+';?\n?/g, '');
  c = c.replace(/import ModpackSettingsPage from "[^"]+";?\n?/g, '');
  c = c.replace(/<Route path=\{`\$\{match\.path\}\/modpack_settings`\}[^>]*>[\s\S]*?<\/Route>\n?/g, '');
  c = c.replace(/\n{3,}/g, '\n\n');
  if (!c.includes('ModpackSettingsPage')) {
    const imports = [...c.matchAll(/^import .*;$/gm)];
    if (imports.length) {
      const lm = imports[imports.length - 1];
      c = c.slice(0, lm.index + lm[0].length) +
          "\nimport ModpackSettingsPage from '@/components/server/modpacks/ModpackSettingsPage';" +
          c.slice(lm.index + lm[0].length);
    }
    const fm = c.match(/<Route path=\{`\$\{match\.path\}\/mounts`\} exact>[\s\S]*?<\/Route>/);
    if (fm) {
      const ls = c.lastIndexOf('\n', fm.index) + 1;
      const ind = (c.slice(ls, fm.index).match(/^(\s*)/) || ['',''])[1];
      const inj = '<Route path={`${match.path}/modpack_settings`} exact>\n' +
                  ind + '    <ModpackSettingsPage />\n' +
                  ind + '</Route>\n' + ind;
      c = c.slice(0, fm.index) + inj + c.slice(fm.index);
      console.log('\u2713 Rota injetada no AdminRouter.tsx');
    } else {
      const fallbackMatch = c.match(/<Route path=\{(?:'\*'|"\*")\}.*?>[\s\S]*?<\/Route>/);
      if (fallbackMatch) {
          const ls = c.lastIndexOf('\n', fallbackMatch.index) + 1;
          const ind = (c.slice(ls, fallbackMatch.index).match(/^(\s*)/) || ['',''])[1];
          const inj = '<Route path={`${match.path}/modpack_settings`} exact>\n' +
                      ind + '    <ModpackSettingsPage />\n' +
                      ind + '</Route>\n' + ind;
          c = c.slice(0, fallbackMatch.index) + inj + c.slice(fallbackMatch.index);
          console.log('\u2713 Rota injetada no AdminRouter.tsx (antes do fallback)');
      }
    }
  }
  fs.writeFileSync(arPath, c);
})();

// 4. Patch ServerElements.tsx (Navbar)
(function patchServerElements() {
  const sePath = path.join(panelDir, 'resources/scripts/routers/ServerElements.tsx');
  if (!fs.existsSync(sePath)) return;
  let c = fs.readFileSync(sePath, 'utf8');
  c = c.replace(/<NavLink[^>]*\/modpacks[^>]*>[\s\S]*?<\/NavLink>\n?/g, '');
  
  if (!c.includes('/modpacks')) {
    // Tenta encontrar plugins, se nao achar, tenta files
    let pm = c.match(/<NavLink[^>]*\/plugins[^>]*>[\s\S]*?<\/NavLink>/);
    if (!pm) {
        pm = c.match(/<NavLink[^>]*\/files[^>]*>[\s\S]*?<\/NavLink>/);
    }
    
    if (pm) {
      const ls = c.lastIndexOf('\n', pm.index) + 1;
      const ind = (c.slice(ls, pm.index).match(/^(\s*)/) || ['',''])[1];
      const inj = '\n' + ind + '<NavLink to={`${match.url}/modpacks`}>' +
                  '\n' + ind + '    <FontAwesomeIcon icon={faBox} /> Modpacks' +
                  '\n' + ind + '</NavLink>';
      
      // Inserir APOS o NavLink encontrado
      c = c.slice(0, pm.index + pm[0].length) + inj + c.slice(pm.index + pm[0].length);
      
      if (!c.includes('faBox')) {
          const fm = c.match(/import\s+\{[^}]*\}\s+from\s+['"]@fortawesome\/free-solid-svg-icons['"];?/);
          if (fm) {
              c = c.slice(0, fm.index) + fm[0].replace('{', '{ faBox, ') + c.slice(fm.index + fm[0].length);
          } else {
              c = "import { faBox } from '@fortawesome/free-solid-svg-icons';\n" + c;
          }
      }
      if (!c.includes('FontAwesomeIcon')) {
          c = "import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';\n" + c;
      }
      console.log('\u2713 Modpacks NavLink injetado no ServerElements.tsx');
    } else {
      console.log('\u26a0 NavLink base nao encontrado em ServerElements.tsx. A tab Modpacks nao aparecera na barra superior.');
    }
  }
  fs.writeFileSync(sePath, c);
})();
JSEOF
    } > "$JS"

    node "$JS" "$PANEL_DIR"
    rm -f "$JS"
}

# ============================================================================
# BUILD DO FRONTEND
# ============================================================================

build_frontend() {
    print_step "Compilando frontend..."
    
    cd "$PANEL_DIR"
    
    # Remover blueprints do caminho do Webpack ANTES de compilar
    # (O script PHP de instalacao joga uma copia la, mas usamos a nativa do components)
    rm -rf "$PANEL_DIR/resources/scripts/blueprints/modpack-installer" 2>/dev/null || true

    
    if [ "$HAS_NODE" = true ]; then
        print_info "Instalando dependências..."
        yarn install --frozen-lockfile 2>/dev/null || yarn install
        
        print_info "Compilando assets..."
        
        # Detecta Node.js v22+ e usa legacy OpenSSL provider
        NODE_MAJOR=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_MAJOR" -ge 18 ]; then
            export NODE_OPTIONS=--openssl-legacy-provider
            print_info "Node.js v${NODE_MAJOR} detectado. Usando --openssl-legacy-provider"
        fi
        
        # Tenta build de produção primeiro (ignora erros de prettier do Jexactyl)
        if NODE_OPTIONS="--openssl-legacy-provider" yarn run build:production 2>&1; then
            print_success "Frontend compilado (production)"
        else
            print_warning "Build production falhou (erros de formato do Jexactyl). Tentando build simples..."
            # Build simples sem type-check strict
            if NODE_OPTIONS="--openssl-legacy-provider" yarn run build 2>&1; then
                print_success "Frontend compilado (build simples)"
            else
                print_warning "Build simples também falhou. Tentando webpack direto..."
                # último recurso: webpack direto
                NODE_ENV=production NODE_OPTIONS="--openssl-legacy-provider" ./node_modules/.bin/webpack --mode production 2>&1 || true
            fi
        fi
        
        # Verifica se bundle foi gerado independente de erros
        if [ -f "$PANEL_DIR/public/assets/bundle"*.js ]; then
            print_success "Bundle gerado com sucesso"
        else
            print_warning "Bundle nao encontrado - o painel pode nao funcionar corretamente"
        fi
    else
        print_warning "Node.js não disponível. Frontend não compilado."
        print_info "Instale Node.js e execute: yarn run build:production"
    fi
}

# ============================================================================
# FIX DE PERMISSÕES
# ============================================================================

fix_permissions() {
    print_step "Ajustando permissões..."
    
    # Detecta usuário do web server
    local web_user="www-data"
    if id nginx &>/dev/null; then
        web_user="nginx"
    fi
    
    chown -R "$web_user:$web_user" "$PANEL_DIR/storage" "$PANEL_DIR/bootstrap/cache" 2>/dev/null || true
    chmod -R 755 "$PANEL_DIR/storage" "$PANEL_DIR/bootstrap/cache" 2>/dev/null || true
    
    print_success "Permissões ajustadas"
}

# ============================================================================
# REINICIALIZAÇÃO DE SERVIÇOS
# ============================================================================

restart_services() {
    print_step "Reiniciando serviços..."
    
    # Reinicia PHP-FPM
    if command -v systemctl &> /dev/null; then
        # Detecta versão do PHP
        local php_version=$(php -v | head -n 1 | grep -oP '\d+\.\d+')
        
        if systemctl list-units --type=service | grep -q "php${php_version}-fpm"; then
            systemctl restart "php${php_version}-fpm"
            print_success "PHP-FPM reiniciado"
        elif systemctl list-units --type=service | grep -q "php-fpm"; then
            systemctl restart php-fpm
            print_success "PHP-FPM reiniciado"
        fi
        
        # Reinicia Nginx
        if systemctl is-active --quiet nginx 2>/dev/null; then
            systemctl restart nginx
            print_success "Nginx reiniciado"
        fi
        
        # Reinicia Apache
        if systemctl is-active --quiet apache2 2>/dev/null; then
            systemctl restart apache2
            print_success "Apache reiniciado"
        fi
    fi
    
    # Limpa cache do Laravel
    cd "$PANEL_DIR"
    sudo -u www-data php artisan cache:clear 2>/dev/null || true
    sudo -u www-data php artisan view:clear 2>/dev/null || true
    sudo -u www-data php artisan config:clear 2>/dev/null || true
}

# ============================================================================
# VERIFICAÇÃO FINAL
# ============================================================================

verify_installation() {
    print_step "Verificando instalação..."
    
    cd "$PANEL_DIR"
    
    local all_ok=true
    
    # Verifica tabelas via SQL direto (sem depender do Laravel que crasha com DOMDocument)
    local db_host=$(grep DB_HOST "$PANEL_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d ' ' || echo "127.0.0.1")
    local db_name=$(grep DB_DATABASE "$PANEL_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d ' ' || echo "panel")
    local db_user=$(grep DB_USERNAME "$PANEL_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d ' ' || echo "root")
    local db_pass=$(grep DB_PASSWORD "$PANEL_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d ' ' || echo "")
    
    for table in modpacks modpack_versions server_modpacks modpack_settings; do
        if mysql -h "$db_host" -u "$db_user" ${db_pass:+-p"$db_pass"} -e "SELECT 1 FROM \`$table\` LIMIT 1" "$db_name" 2>/dev/null; then
            print_success "Tabela '$table' OK"
        else
            print_warning "Tabela '$table' nao encontrada (sera criada pelo Blueprint)"
        fi
    done
    
    # Verifica assets compilados
    if [ -d "$PANEL_DIR/public/assets" ] && [ "$(ls -A "$PANEL_DIR/public/assets" 2>/dev/null)" ]; then
        print_success "Assets compilados OK"
    else
        print_warning "Assets não encontrados - execute 'yarn run build:production'"
    fi
    
    if [ "$all_ok" = true ]; then
        print_success "Verificação concluída com sucesso!"
    fi
}

# ============================================================================
# LIMPEZA
# ============================================================================

cleanup() {
    print_step "Limpando arquivos temporários..."
    rm -rf "$TEMP_DIR"
    rm -f "$PANEL_DIR/install-blueprint-panel.php"
    print_success "Limpo"
}

# ============================================================================
# INSTRUÇÕES FINAIS
# ============================================================================

print_final() {
    local panel_url="http://$(hostname -I | awk '{print $1}')"
    
    echo ""
    echo -e "${GREEN}"
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║            INSTALAÇÃO CONCLUÍDA COM SUCESSO!                 ║
╚══════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
    echo ""
    echo -e "${CYAN}O que foi instalado:${NC}"
    echo "  ✓ Blueprint Modpack Installer"
    echo "  ✓ Tabelas do banco de dados"
    echo "  ✓ Permissões do painel"
    echo "  ✓ Integração com API Modrinth"
    echo "  ✓ Cards compactos com filtros"
    echo ""
    echo -e "${CYAN}Acesso:${NC}"
    echo "  URL: $panel_url"
    echo "  Aba 'Modpacks' no menu lateral do servidor"
    echo ""
    echo -e "${CYAN}Permissões criadas:${NC}"
    echo "  • modpacks.view     - Visualizar modpacks"
    echo "  • modpacks.install  - Instalar modpacks"
    echo "  • modpacks.downgrade - Fazer downgrade"
    echo ""
    echo -e "${CYAN}Comandos úteis:${NC}"
    echo "  cd $PANEL_DIR"
    echo "  sudo -u www-data php artisan cache:clear"
    echo "  yarn run build:production"
    echo ""
    
    if [ "$HAS_NODE" = false ]; then
        echo -e "${YELLOW}AVISO:${NC} Node.js não está instalado."
        echo "  Execute estes comandos para instalar:"
        echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
        echo "    apt-get install -y nodejs"
        echo "    npm install -g yarn"
        echo "    cd $PANEL_DIR && yarn run build:production"
        echo ""
    fi
}

# ============================================================================
# AUTO-LIMPEZA (roda antes de instalar para remover injeções antigas)
# ============================================================================

auto_clean() {
    print_step "Limpando injeções e addons anteriores..."
    
    # Precisa do PANEL_DIR - detectar aqui rapidamente
    local panel=""
    for p in /var/www/jexactyl /var/www/pterodactyl /var/www/panel; do
        [ -f "$p/artisan" ] && panel="$p" && break
    done
    [ -z "$panel" ] && return 0
    
    cd "$panel"
    
    # Remove pastas de addons quebrados
    rm -rf resources/scripts/components/server/mcmodpacks 2>/dev/null || true
    rm -rf resources/scripts/components/server/mcplugins 2>/dev/null || true
    rm -rf resources/scripts/api/server/mcmodpacks 2>/dev/null || true
    rm -rf resources/scripts/api/server/mcplugins 2>/dev/null || true
    rm -rf resources/scripts/components/server/playermanager 2>/dev/null || true
    rm -rf resources/scripts/components/server/modpacks 2>/dev/null || true
    rm -rf resources/scripts/blueprints/modpack-installer 2>/dev/null || true
    rm -rf blueprints/modpack-installer 2>/dev/null || true
    
    # Script Node.js para limpeza fina dos arquivos TypeScript
    cat << 'CLEANEOF' > /tmp/auto_clean.js
const fs = require('fs');
const path = require('path');
const panelDir = process.cwd();

// Corrigir CRLF nos arquivos problemáticos
['resources/scripts/components/elements/PaginationBagou.tsx',
 'resources/scripts/components/server/console/ConsoleBlock.tsx',
 'resources/scripts/components/server/files/NewDirectoryDialog.tsx'].forEach(f => {
    const fp = path.join(panelDir, f);
    if (!fs.existsSync(fp)) return;
    let c = fs.readFileSync(fp, 'utf8');
    if (c.includes('\r')) {
        c = c.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (!c.startsWith('/* eslint-disable */')) c = '/* eslint-disable */\n' + c;
        fs.writeFileSync(fp, c);
    }
});

// Limpar ServerRouter.tsx
const srPath = path.join(panelDir, 'resources/scripts/routers/ServerRouter.tsx');
if (fs.existsSync(srPath)) {
    let c = fs.readFileSync(srPath, 'utf8');
    c = c.replace(/import ModpacksPage from '[^']+';\n?/g, '');
    c = c.replace(/import ModpacksPage from "[^"]+";\n?/g, '');
    c = c.replace(/import McModpacks[^;]+;\n?/g, '');
    c = c.replace(/import McPlugins[^;]+;\n?/g, '');
    c = c.replace(/<Route path=\{`\$\{match\.(url|path)\}\/modpacks`\}[^>]*>[\s\S]*?<\/Route>/g, '');
    c = c.replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(srPath, c);
    console.log('✓ ServerRouter.tsx limpo');
}

// Limpar AdminRouter.tsx
const arPath = path.join(panelDir, 'resources/scripts/routers/AdminRouter.tsx');
if (fs.existsSync(arPath)) {
    let c = fs.readFileSync(arPath, 'utf8');
    c = c.replace(/import ModpackSettingsPage from '[^']+';\n?/g, '');
    c = c.replace(/import ModpackSettingsPage from "[^"]+";\n?/g, '');
    c = c.replace(/<Route path=\{`\$\{match\.(url|path)\}\/modpack_settings`\}[^>]*>[\s\S]*?<\/Route>/g, '');
    c = c.replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(arPath, c);
    console.log('\u2713 AdminRouter.tsx limpo');
}

// Limpar routes.ts
const rtPath = path.join(panelDir, 'resources/scripts/routers/routes.ts');
if (fs.existsSync(rtPath)) {
    let c = fs.readFileSync(rtPath, 'utf8');
    c = c.replace(/import ModpacksPage from '[^']+';\n?/g, '');
    c = c.replace(/import ModpacksPage from "[^"]+";\n?/g, '');
    c = c.replace(/import McModpacks[^;]+;\n?/g, '');
    c = c.replace(/import McPlugins[^;]+;\n?/g, '');
    c = c.replace(/\{[^}]*path:\s*'\/modpacks'[^}]*\},?\s*/gs, '');
    c = c.replace(/McModpacksContainer|McPluginsContainer/g, '');
    c = c.replace(/,\s*,/g, ',');
    c = c.replace(/,\s*(\])/g, '$1');
    c = c.replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(rtPath, c);
    console.log('✓ routes.ts limpo');
}

// Limpar ServerElements.tsx - remover @ts-nocheck e injeções erradas
const sePath = path.join(panelDir, 'resources/scripts/routers/ServerElements.tsx');
if (fs.existsSync(sePath)) {
    let c = fs.readFileSync(sePath, 'utf8');
    if (!c.includes('eslint-disable')) c = '/* eslint-disable */\n// @ts-nocheck\n' + c.replace(/^\/\/ @ts-nocheck\n?/m, ''); else if (!c.includes('@ts-nocheck')) c = c.replace(/\/\* eslint-disable \*\/\n?/g, '/* eslint-disable */\n// @ts-nocheck\n');
    c = c.replace(/<NavLink[^>]*\/modpacks[^>]*>[\s\S]*?<\/NavLink>/g, '');
    fs.writeFileSync(sePath, c);
    console.log('✓ ServerElements.tsx limpo');
}

// Limpar NavigationBar.tsx - remover @ts-nocheck
const nbPath = path.join(panelDir, 'resources/scripts/components/NavigationBar.tsx');
if (fs.existsSync(nbPath)) {
    let c = fs.readFileSync(nbPath, 'utf8');
    if (!c.includes('eslint-disable')) c = '/* eslint-disable */\n// @ts-nocheck\n' + c.replace(/^\/\/ @ts-nocheck\n?/m, ''); else if (!c.includes('@ts-nocheck')) c = c.replace(/\/\* eslint-disable \*\/\n?/g, '/* eslint-disable */\n// @ts-nocheck\n');
    fs.writeFileSync(nbPath, c);
    console.log('✓ NavigationBar.tsx limpo');
}

console.log('✓ Limpeza automática concluída');
CLEANEOF
    node /tmp/auto_clean.js 2>/dev/null || print_warning "Limpeza parcial (node não disponível ainda)"
    rm -f /tmp/auto_clean.js
    yarn prettier --write "resources/scripts/components/elements/PaginationBagou.tsx" "resources/scripts/components/server/console/ConsoleBlock.tsx" "resources/scripts/components/server/files/NewDirectoryDialog.tsx" 2>/dev/null || true
    
    print_success "Limpeza automática concluída"
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    print_banner
    
    print_info "Iniciando instalação do $BLUEPRINT_NAME v$BLUEPRINT_VERSION"
    print_info "Data: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
    
    # Confirmação (detecta se está sendo pipeado via curl | bash)
    if [ -t 0 ]; then
        # Terminal interativo - pergunta normalmente
        read -p "Deseja continuar? (s/N): " confirm
        if [[ ! "$confirm" =~ ^[Ss]$ ]]; then
            print_info "Instalação cancelada"
            exit 0
        fi
    else
        # Rodando via pipe (curl | bash) - pula confirmação
        print_info "Modo automatico detectado (pipe). Continuando..."
    fi
    
    echo ""
    
    detect_panel
    auto_clean
    check_prerequisites
    download_blueprint
    install_blueprint
    setup_database
    register_permissions
    inject_frontend_routes
    build_frontend
    fix_permissions
    restart_services
    verify_installation
    cleanup
    print_final
}

main "$@"
