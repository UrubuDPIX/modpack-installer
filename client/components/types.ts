/* eslint-disable */
// Shared TypeScript interfaces for Modpack Installer
// This file is intentionally a flat copy of types/index.ts so that
// when client/components/ and client/pages/ are merged into the same
// modpacks/ directory, imports of './types' resolve correctly.

export interface Modpack {
  id: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  downloads: number;
  createdAt: string;
  versions: ModpackVersion[];
}

export interface ModpackVersion {
  id: string;
  modpackId: string;
  name: string;
  minecraftVersion: string;
  loader: "Forge" | "Fabric" | "NeoForge" | "Quilt";
  loaderVersion: string;
  size: string;
  downloadUrl: string;
  isServerPack: boolean;
  isRelease: boolean;
  releasedAt: string;
  changelog?: string;
}

export interface ServerModpack {
  id: string;
  serverId: string;
  modpack: Modpack;
  version: ModpackVersion;
  installedAt: string;
  updatedAt: string;
  status: "installing" | "installed" | "error";
  installLog?: string;
}

export interface InstallRequest {
  modpackId: string;
  versionId: string;
  action: "install" | "reinstall" | "downgrade" | "update";
}
