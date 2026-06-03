<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('server_modpacks', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('server_id');
            $table->char('modpack_id', 36);
            $table->char('modpack_version_id', 36);
            $table->timestamp('installed_at');

            $table->foreign('server_id')->references('id')->on('servers')->onDelete('cascade');
            $table->foreign('modpack_id')->references('id')->on('modpacks')->onDelete('cascade');
            $table->foreign('modpack_version_id')->references('id')->on('modpack_versions')->onDelete('cascade');
            
            $table->unique('server_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('server_modpacks');
    }
};
