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
        Schema::create('modpack_versions', function (Blueprint $table) {
            $table->char('id', 36)->primary();
            $table->char('modpack_id', 36);
            $table->string('name');
            $table->text('download_url');
            $table->enum('type', ['stable', 'beta', 'alpha'])->default('stable');
            $table->timestamp('release_date');
            $table->timestamps();

            $table->foreign('modpack_id')->references('id')->on('modpacks')->onDelete('cascade');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('modpack_versions');
    }
};
