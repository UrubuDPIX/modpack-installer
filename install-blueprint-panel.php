<?php
// Script para instalar o Modpack Installer Blueprint no Pterodactyl/Jexactyl

// Detecta diretorio do painel
$panelDir = null;
foreach (['/var/www/pterodactyl', '/var/www/jexactyl', '/var/www/panel', getcwd()] as $dir) {
    if (file_exists($dir . '/vendor/autoload.php') && file_exists($dir . '/bootstrap/app.php')) {
        $panelDir = $dir;
        break;
    }
}

if (!$panelDir) {
    echo "ERRO: Nao foi possivel detectar o diretorio do painel!\n";
    echo "Execute este script de dentro do diretorio do Pterodactyl/Jexactyl.\n";
    exit(1);
}

require $panelDir . '/vendor/autoload.php';
$app = require_once $panelDir . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

echo "==============================================\n";
echo "  Instalando Modpack Installer Blueprint\n";
echo "  Painel detectado em: $panelDir\n";
echo "==============================================\n\n";

// 1. Verificar blueprint.json
$blueprintPath = $panelDir . '/blueprint.json';
if (!file_exists($blueprintPath)) {
    echo "ERRO: blueprint.json nao encontrado em $blueprintPath!\n";
    exit(1);
}

$blueprint = json_decode(file_get_contents($blueprintPath), true);
echo "Blueprint: {$blueprint['name']} v{$blueprint['version']}\n";
echo "Target: {$blueprint['target']}\n\n";

// 2. Verificar estrutura
echo "Verificando estrutura...\n";
$required = [
    $panelDir . '/client/index.tsx' => 'Client entrypoint',
    $panelDir . '/server/index.ts' => 'Server entrypoint',
];

foreach ($required as $path => $desc) {
    if (file_exists($path)) {
        echo "  ✓ $desc\n";
    } else {
        echo "  ✗ $desc (faltando)\n";
    }
}

// 3. Registrar permissoes no banco
echo "\nRegistrando permissoes...\n";
try {
    $db = $app->make('db');
    
    foreach ($blueprint['permissions'] as $perm) {
        // Verificar se permissao ja existe
        $exists = $db->table('permissions')->where('permission', $perm['key'])->first();
        if (!$exists) {
            $db->table('permissions')->insert([
                'permission' => $perm['key'],
                'description' => $perm['description'],
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            echo "  ✓ Permissao registrada: {$perm['key']}\n";
        } else {
            echo "  ℹ Permissao ja existe: {$perm['key']}\n";
        }
    }
} catch (Exception $e) {
    echo "  ⚠ Erro ao registrar permissoes: " . $e->getMessage() . "\n";
}

// 4. Criar tabelas se necessario
echo "\nCriando tabelas do blueprint...\n";
try {
    $schema = $app->make('db')->getSchemaBuilder();
    
    // Tabela de modpacks
    if (!$schema->hasTable('modpacks')) {
        $schema->create('modpacks', function ($table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->text('description')->nullable();
            $table->string('icon')->nullable();
            $table->string('source')->default('curseforge'); // curseforge, modrinth, etc
            $table->string('source_id')->nullable();
            $table->string('minecraft_version');
            $table->string('modloader'); // forge, fabric, neoforge
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
        echo "  ✓ Tabela 'modpacks' criada\n";
    } else {
        echo "  ℹ Tabela 'modpacks' ja existe\n";
    }
    
    // Tabela de versoes de modpacks
    if (!$schema->hasTable('modpack_versions')) {
        $schema->create('modpack_versions', function ($table) {
            $table->id();
            $table->foreignId('modpack_id')->constrained()->onDelete('cascade');
            $table->string('version');
            $table->string('download_url');
            $table->bigInteger('file_size')->nullable();
            $table->string('checksum')->nullable();
            $table->boolean('is_recommended')->default(false);
            $table->timestamps();
            $table->unique(['modpack_id', 'version']);
        });
        echo "  ✓ Tabela 'modpack_versions' criada\n";
    } else {
        echo "  ℹ Tabela 'modpack_versions' ja existe\n";
    }
    
    // Tabela de modpacks instalados nos servidores
    if (!$schema->hasTable('server_modpacks')) {
        $schema->create('server_modpacks', function ($table) {
            $table->id();
            $table->unsignedBigInteger('server_id');
            $table->index('server_id');
            $table->foreignId('modpack_id')->constrained();
            $table->foreignId('modpack_version_id')->constrained('modpack_versions');
            $table->string('status')->default('pending'); // pending, installing, installed, failed
            $table->text('install_log')->nullable();
            $table->timestamp('installed_at')->nullable();
            $table->timestamps();
        });
        echo "  ✓ Tabela 'server_modpacks' criada\n";
    } else {
        echo "  ℹ Tabela 'server_modpacks' ja existe\n";
    }
    
} catch (Exception $e) {
    echo "  ⚠ Erro ao criar tabelas: " . $e->getMessage() . "\n";
}

// 5. Copiar assets para o frontend (integrar ao webpack/build)
echo "\nIntegrando frontend...\n";
echo "  ℹ Frontend blueprint disponivel em: {$panelDir}/client/\n";
echo "  ℹ Para compilar: yarn run build:production\n";

// Criar diretorio para o blueprint no resources
$blueprintResourceDir = $panelDir . '/resources/scripts/blueprints/modpack-installer';
if (!is_dir($blueprintResourceDir)) {
    mkdir($blueprintResourceDir, 0755, true);
}

// Copiar arquivos do cliente
if (is_dir($panelDir . '/client')) {
    shell_exec("cp -r " . $panelDir . "/client/* $blueprintResourceDir/ 2>/dev/null");
    echo "  ✓ Arquivos do cliente copiados\n";
}

echo "\n==============================================\n";
echo "  Blueprint instalado com sucesso!\n";
echo "==============================================\n";
echo "\nProximos passos:\n";
echo "1. Recompilar assets: yarn run build:production\n";
echo "2. Reiniciar o container: docker compose restart\n";
echo "3. Acessar o painel e verificar o menu 'Modpacks'\n";
echo "\n";
