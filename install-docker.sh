#!/bin/bash
# ============================================================================
# Modpack Installer - Docker Install Script
# ============================================================================
# Script otimizado para instalação em ambiente Docker
# Execute este script no HOST (fora do container)
# ============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="pteo"

print_banner() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║       🎮 Modpack Installer - Docker Installer              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() { echo -e "${BLUE}[PASSO]${NC} $1"; }
print_success() { echo -e "${GREEN}[OK]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[AVISO]${NC} $1"; }
print_error() { echo -e "${RED}[ERRO]${NC} $1"; }
print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }

# Verifica Docker
if ! command -v docker &> /dev/null; then
    print_error "Docker não encontrado. Instale o Docker primeiro."
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    print_error "Docker Compose não encontrado."
    exit 1
fi

print_banner

# Detecta docker compose command
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

cd "${SCRIPT_DIR}"

print_step "Verificando containers..."
${COMPOSE_CMD} ps

echo ""
print_step "Instalando blueprint no container..."

# Cria diretório do blueprint no container
${COMPOSE_CMD} exec panel mkdir -p /app/blueprints/modpack-installer

# Copia arquivos do blueprint
print_info "Copiando arquivos do blueprint..."
docker cp "${SCRIPT_DIR}/blueprint.json" "${PROJECT_NAME}-panel-1:/app/blueprints/modpack-installer/"
docker cp "${SCRIPT_DIR}/client" "${PROJECT_NAME}-panel-1:/app/blueprints/modpack-installer/"
docker cp "${SCRIPT_DIR}/server" "${PROJECT_NAME}-panel-1:/app/blueprints/modpack-installer/"
docker cp "${SCRIPT_DIR}/prisma" "${PROJECT_NAME}-panel-1:/app/blueprints/modpack-installer/"
docker cp "${SCRIPT_DIR}/database" "${PROJECT_NAME}-panel-1:/app/blueprints/modpack-installer/"
docker cp "${SCRIPT_DIR}/install-blueprint-panel.php" "${PROJECT_NAME}-panel-1:/app/"

print_success "Arquivos copiados"

# Executa script PHP de instalação
print_step "Executando instalação PHP..."
${COMPOSE_CMD} exec panel php /app/install-blueprint-panel.php || print_warning "Script PHP falhou, continuando..."

# Registra permissões
print_step "Registrando permissões..."
${COMPOSE_CMD} exec panel php -r "
require '/app/vendor/autoload.php';
\$app = require_once '/app/bootstrap/app.php';
\$kernel = \$app->make(Illuminate\Contracts\Console\Kernel::class);
\$kernel->bootstrap();

\$permissions = [
    ['permission' => 'modpacks.view', 'description' => 'Visualizar modpacks'],
    ['permission' => 'modpacks.install', 'description' => 'Instalar modpacks'],
    ['permission' => 'modpacks.downgrade', 'description' => 'Downgrade de modpacks'],
];

foreach (\$permissions as \$perm) {
    \$exists = DB::table('permissions')->where('permission', \$perm['permission'])->first();
    if (!\$exists) {
        DB::table('permissions')->insert(array_merge(\$perm, [
            'created_at' => now(),
            'updated_at' => now(),
        ]));
        echo 'Permissão registrada: ' . \$perm['permission'] . PHP_EOL;
    }
}
" || print_warning "Registro de permissões falhou"

# Limpa cache
print_step "Limpando cache..."
${COMPOSE_CMD} exec panel php /app/artisan config:clear 2>/dev/null || true
${COMPOSE_CMD} exec panel php /app/artisan cache:clear 2>/dev/null || true

# Rebuilda assets se node disponível
print_step "Verificando build de assets..."
if ${COMPOSE_CMD} exec panel which yarn &> /dev/null; then
    print_info "Yarn encontrado, compilando assets..."
    ${COMPOSE_CMD} exec panel yarn run build:production || print_warning "Build falhou"
else
    print_warning "Yarn não disponível no container."
    print_info "Para rebuildar assets, execute:"
    print_info "  docker run --rm -v \"\$(pwd):/app\" -w /app node:22-alpine sh -c 'yarn install && yarn run build:production'"
fi

echo ""
print_success "Instalação concluída!"
echo ""
print_info "Acesse: http://localhost"
print_info "A aba 'Modpacks' deve aparecer no menu lateral"
echo ""
