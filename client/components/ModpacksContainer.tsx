/* eslint-disable */
import React, { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faDownload,
  faBox,
  faCheck,
  faExclamationTriangle,
  faSearch,
} from "@fortawesome/free-solid-svg-icons";

interface ModrinthProject {
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  categories: string[];
  downloads: number;
  followers: number;
  date_created: string;
  versions: string[];
  loaders: string[];
  game_versions: string[];
  latest_version: ModrinthVersion | null;
}

interface ModrinthVersion {
  id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: { url: string; size: number; filename: string }[];
  date_published: string;
  downloads: number;
  version_type: string;
}

const CATEGORIES = [
  { key: "adventure", label: "Adventure" },
  { key: "challenging", label: "Challenging" },
  { key: "combat", label: "Combat" },
  { key: "kitchen-sink", label: "Kitchen Sink" },
  { key: "lightweight", label: "Lightweight" },
  { key: "magic", label: "Magic" },
  { key: "multiplayer", label: "Multiplayer" },
  { key: "optimization", label: "Optimization" },
  { key: "quests", label: "Quests" },
  { key: "technology", label: "Technology" },
];

const LOADERS = ["forge", "fabric", "quilt", "neoforge"];

const MINECRAFT_VERSIONS = [
  "1.21.4",
  "1.21.1",
  "1.20.6",
  "1.20.4",
  "1.20.1",
  "1.19.4",
  "1.19.2",
  "1.18.2",
];

interface ModpacksContainerProps {
  serverId: string;
}

export default function ModpacksContainer({
  serverId,
}: ModpacksContainerProps) {
  const id = serverId;
  const [modpacks, setModpacks] = useState<ModrinthProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedLoader, setSelectedLoader] = useState("");
  const [selectedVersion, setSelectedVersion] = useState("");
  const [sortBy, setSortBy] = useState<
    "relevance" | "downloads" | "follows" | "newest"
  >("relevance");
  const [installedModpack, setInstalledModpack] = useState<any>(null);

  const buildSearchUrl = () => {
    const facets: string[] = ['["project_type:modpack"]'];
    if (selectedCategory) facets.push(`["categories:${selectedCategory}"]`);
    if (selectedLoader) facets.push(`["categories:${selectedLoader}"]`);
    if (selectedVersion) facets.push(`["versions:${selectedVersion}"]`);

    let url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(searchQuery || "")}&index=${sortBy}&limit=50`;
    if (facets.length > 0) {
      url += `&facets=${encodeURIComponent(facets.join(","))}`;
    }
    return url;
  };

  const fetchModrinthModpacks = async () => {
    try {
      setLoading(true);
      const response = await fetch(buildSearchUrl());
      if (!response.ok) throw new Error("Erro ao buscar modpacks");
      const data = await response.json();
      const hits = data.hits || [];

      // Fetch latest version for each modpack
      const enriched = await Promise.all(
        hits.map(async (hit: any) => {
          try {
            const vRes = await fetch(
              `https://api.modrinth.com/v2/project/${hit.slug}/version?limit=1`,
            );
            const versions = vRes.ok ? await vRes.json() : [];
            return {
              ...hit,
              latest_version: versions[0] || null,
            };
          } catch {
            return { ...hit, latest_version: null };
          }
        }),
      );

      setModpacks(enriched);
    } catch (err) {
      setError("Não foi possível carregar os modpacks do Modrinth");
    } finally {
      setLoading(false);
    }
  };

  const fetchInstalledModpack = async () => {
    try {
      const response = await fetch(`/api/client/servers/${id}/modpack`);
      if (!response.ok) throw new Error("Erro ao verificar modpack instalado");
      const data = await response.json();
      if (data.server_modpack) {
        setInstalledModpack(data);
      }
    } catch (err) {
      console.log("Nenhum modpack instalado");
    }
  };

  useEffect(() => {
    fetchModrinthModpacks();
    if (id) fetchInstalledModpack();
  }, [id, selectedCategory, selectedLoader, selectedVersion, sortBy]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchModrinthModpacks();
  };

  const installModpack = async (slug: string, versionId: string) => {
    try {
      const response = await fetch(`/api/client/servers/${id}/modpack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modpack_slug: slug, version_id: versionId }),
      });
      if (!response.ok) throw new Error("Erro ao instalar modpack");
      alert("Modpack agendado para instalação!");
      fetchInstalledModpack();
    } catch (err) {
      alert("Erro ao instalar modpack");
    }
  };

  const formatDownloads = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  return (
    <div className="p-6" style={{ maxWidth: 1200, margin: "0 auto" }}>
      <h1 className="text-2xl font-bold mb-2 flex items-center">
        <FontAwesomeIcon icon={faBox} className="mr-3" />
        Modpacks Disponíveis
      </h1>
      <p className="text-gray-400 text-sm mb-6">
        Descubra e instale modpacks populares do Modrinth no seu servidor
      </p>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-200 p-3 rounded mb-4 flex items-center text-sm">
          <FontAwesomeIcon icon={faExclamationTriangle} className="mr-2" />
          {error}
        </div>
      )}

      {installedModpack && (
        <div className="bg-green-900/30 border border-green-700 p-3 rounded mb-4">
          <h2 className="text-sm font-semibold mb-1 flex items-center text-green-300">
            <FontAwesomeIcon icon={faCheck} className="mr-2" />
            Modpack Instalado: {installedModpack.modpack?.name}
          </h2>
          <p className="text-gray-300 text-xs">
            Versão: {installedModpack.version?.version} | Status:{" "}
            {installedModpack.server_modpack?.status}
          </p>
        </div>
      )}

      {/* Filters */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <FontAwesomeIcon
              icon={faSearch}
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 text-sm"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar modpacks..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Buscar
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          >
            <option value="">Todas Categorias</option>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>

          <select
            value={selectedLoader}
            onChange={(e) => setSelectedLoader(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          >
            <option value="">Todos Loaders</option>
            {LOADERS.map((l) => (
              <option key={l} value={l}>
                {l.charAt(0).toUpperCase() + l.slice(1)}
              </option>
            ))}
          </select>

          <select
            value={selectedVersion}
            onChange={(e) => setSelectedVersion(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          >
            <option value="">Todas Versões</option>
            {MINECRAFT_VERSIONS.map((v) => (
              <option key={v} value={v}>
                MC {v}
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          >
            <option value="relevance">Relevância</option>
            <option value="downloads">Mais Downloads</option>
            <option value="follows">Mais Populares</option>
            <option value="newest">Mais Recentes</option>
          </select>
        </div>
      </form>

      {/* Recommended / Categories */}
      {!selectedCategory && !searchQuery && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">
            Categorias Populares
          </h3>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.slice(0, 6).map((cat) => (
              <button
                key={cat.key}
                onClick={() => setSelectedCategory(cat.key)}
                className="bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-blue-500 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg text-xs transition-all"
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
        </div>
      ) : modpacks.length === 0 ? (
        <div className="text-gray-400 text-center py-16">
          <FontAwesomeIcon icon={faBox} className="text-4xl mb-4 opacity-30" />
          <p className="text-lg mb-2">Nenhum modpack encontrado</p>
          <p className="text-sm text-gray-500">
            Tente ajustar os filtros ou termos de busca.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {modpacks.map((modpack) => (
            <div
              key={modpack.slug}
              className="bg-gray-800 border border-gray-700 rounded-xl p-4 hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/10 transition-all group"
            >
              <div className="flex items-start gap-3 mb-3">
                <img
                  src={modpack.icon_url || "/default-modpack.png"}
                  alt={modpack.title}
                  className="w-12 h-12 rounded-lg object-cover border border-gray-600 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-white truncate group-hover:text-blue-400 transition-colors">
                    {modpack.title}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {formatDownloads(modpack.downloads)} downloads
                  </p>
                </div>
              </div>

              <p className="text-xs text-gray-400 line-clamp-2 mb-3 h-8">
                {modpack.description}
              </p>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {modpack.categories.slice(0, 3).map((cat) => (
                  <span
                    key={cat}
                    className="bg-gray-700/50 text-gray-300 px-2 py-0.5 rounded text-[10px] uppercase tracking-wide"
                  >
                    {cat}
                  </span>
                ))}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-gray-700/50">
                <div className="flex flex-col gap-0.5">
                  {modpack.game_versions.slice(0, 1).map((v) => (
                    <span key={v} className="text-[10px] text-gray-500">
                      MC {v}
                    </span>
                  ))}
                  {modpack.loaders.slice(0, 1).map((l) => (
                    <span
                      key={l}
                      className="text-[10px] text-gray-500 capitalize"
                    >
                      {l}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() =>
                    modpack.latest_version &&
                    installModpack(modpack.slug, modpack.latest_version.id)
                  }
                  disabled={!modpack.latest_version || !id}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  <FontAwesomeIcon icon={faDownload} className="text-[10px]" />
                  Instalar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
