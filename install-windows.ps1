# ============================================================================
# Modpack Installer - Windows Installer (PowerShell)
# ============================================================================
# Script de instalação para ambientes Windows com Docker Desktop
# Execute no PowerShell como Administrador
# ============================================================================

$Red = "`e[91m"
$Green = "`e[92m"
$Yellow = "`e[93m"
$Blue = "`e[94m"
$NC = "`e[0m"

function Print-Banner {
    Write-Host "$Blue" -NoNewline
    Write-Host @"
`n╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🎮  Modpack Installer - Windows Installer                ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
"@
    Write-Host "$NC" -NoNewline
}

function Print-Step { param([string]$msg) Write-Host "$Blue[PASSO]$NC $msg" }
function Print-Success { param([string]$msg) Write-Host "$Green[OK]$NC $msg" }
function Print-Warning { param([string]$msg) Write-Host "$Yellow[AVISO]$NC $msg" }
function Print-Error { param([string]$msg) Write-Host "$Red[ERRO]$NC $msg" }
function Print-Info { param([string]$msg) Write-Host "$Blue[INFO]$NC $msg" }

Print-Banner

# Verifica Docker
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    Print-Error "Docker não encontrado. Instale o Docker Desktop."
    exit 1
}

Print-Step "Verificando Docker..."
docker ps > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Print-Error "Docker não está rodando. Inicie o Docker Desktop."
    exit 1
}
Print-Success "Docker está rodando"

# Diretório do script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $scriptDir) { $scriptDir = Get-Location }

Set-Location $scriptDir

Print-Step "Verificando containers..."
docker compose ps

Print-Step "Copiando arquivos do blueprint para o container..."

# Verifica se container existe
$container = docker ps --filter "name=pteo-panel-1" --format "{{.Names}}"
if (-not $container) {
    Print-Error "Container pteo-panel-1 não encontrado!"
    Print-Info "Verifique se o painel está rodando: docker compose up -d"
    exit 1
}

# Cria diretório no container
docker exec $container mkdir -p /app/blueprints/modpack-installer

# Copia arquivos
Print-Info "Copiando blueprint.json..."
docker cp "$scriptDir\blueprint.json" "$container`:app/blueprints/modpack-installer/"

if (Test-Path "$scriptDir\client") {
    Print-Info "Copiando client..."
    docker cp "$scriptDir\client" "$container`:app/blueprints/modpack-installer/"
}

if (Test-Path "$scriptDir\server") {
    Print-Info "Copiando server..."
    docker cp "$scriptDir\server" "$container`:app/blueprints/modpack-installer/"
}

if (Test-Path "$scriptDir\install-blueprint-panel.php") {
    Print-Info "Copiando script de instalação PHP..."
    docker cp "$scriptDir\install-blueprint-panel.php" "$container`:app/"
}

Print-Success "Arquivos copiados"

# Executa instalação PHP
Print-Step "Executando instalação PHP..."
docker exec $container php /app/install-blueprint-panel.php
if ($LASTEXITCODE -ne 0) {
    Print-Warning "Script PHP retornou erro, continuando..."
}

# Registra permissões
Print-Step "Registrando permissões..."
$permsScript = @"
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
    } else {
        echo 'Permissão já existe: ' . \$perm['permission'] . PHP_EOL;
    }
}
echo 'Permissões configuradas!' . PHP_EOL;
"@

docker exec $container php -r "$permsScript"
if ($LASTEXITCODE -ne 0) {
    Print-Warning "Registro de permissões falhou"
}

# Limpa cache
Print-Step "Limpando cache..."
docker exec $container php /app/artisan config:clear 2>$null
docker exec $container php /app/artisan cache:clear 2>$null

Print-Success "Cache limpo"

# Verifica se precisa rebuildar
Print-Step "Verificando necessidade de rebuild..."
$hasNode = docker exec $container which yarn 2>$null
if (-not $hasNode) {
    Print-Warning "Node/Yarn não disponível no container."
    Print-Info "Para compilar os assets do frontend:"
    Print-Info "  1. Pare os containers: docker compose down"
    Print-Info "  2. Rebuildar: docker compose up -d --build"
} else {
    Print-Info "Compilando assets..."
    docker exec $container yarn run build:production
    if ($LASTEXITCODE -eq 0) {
        Print-Success "Assets compilados com sucesso"
    } else {
        Print-Warning "Falha ao compilar assets"
    }
}

Print-Success "Instalação concluída!"
Write-Host ""
Print-Info "Acesse o painel em: http://localhost"
Print-Info "A aba 'Modpacks' deve aparecer no menu lateral do servidor"
Write-Host ""
Print-Info "Para rebuildar a imagem completa (se necessário):"
Print-Info "  docker compose down && docker compose up -d --build"
Write-Host ""

Read-Host "Pressione ENTER para sair"
