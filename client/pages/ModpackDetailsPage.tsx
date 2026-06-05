/* eslint-disable */
import React, { useEffect, useState } from "react";
import { useParams, useHistory } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faDownload,
  faBox,
  faCheck,
  faExclamationTriangle,
  faArrowLeft,
  faExternalLinkAlt,
  faClock,
  faCalendar,
} from "@fortawesome/free-solid-svg-icons";
// @ts-ignore
import PageContentBlock from "@/components/elements/PageContentBlock";
// @ts-ignore
import ServerContext from "@/state/server/ServerContext";

const LOADERS = ["fabric", "forge", "quilt", "neoforge", "liteloader", "rift", "modloader"];
const MINECRAFT_VERSIONS = [
  "1.21", "1.20", "1.19", "1.18", "1.17", "1.16", "1.15", "1.14", "1.13", "1.12", "1.11", "1.10", "1.9", "1.8"
];

interface ModpackVersion {
  id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  date_published: string;
  downloads: number;
  version_type: string;
  files?: any[];
}

interface ModpackDetail {
  id: string | number;
  slug: string;
  title: string;
  description: string;
  body: string;
  icon_url: string | null;
  categories: string[];
  downloads: number;
  followers: number;
  date_created: string;
  date_modified: string;
  game_versions: string[];
  loaders: string[];
  latest_version: ModpackVersion | null;
  author?: string;
  url?: string;
  gallery?: string[];
}

export default function ModpackDetailsPage() {
  const { slug } = useParams<{ slug: string }>();
  const history = useHistory();
  const serverId = ServerContext.useStoreState((state: any) => state.server.data?.uuid);

  const [modpack, setModpack] = useState<ModpackDetail | null>(null);
  const [versions, setVersions] = useState<ModpackVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"description" | "versions">("description");
  const [provider, setProvider] = useState<"modrinth" | "curseforge">("modrinth");
  const [installing, setInstalling] = useState(false);

  const curseforgeKey = localStorage.getItem("modpack_curseforge_key") || "";

  useEffect(() => {
    const storedProvider = localStorage.getItem("modpack_provider") as "modrinth" | "curseforge";
    if (storedProvider) setProvider(storedProvider);
  }, []);

  useEffect(() => {
    if (!slug) return;
    fetchDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const fetchDetails = async () => {
    setLoading(true);
    setError(null);
    try {
      if (provider === "modrinth") {
        // Buscar projeto completo
        const [projectRes, versionsRes] = await Promise.all([
          fetch(`https://api.modrinth.com/v2/project/${slug}`),
          fetch(`https://api.modrinth.com/v2/project/${slug}/version`),
        ]);
        if (!projectRes.ok) throw new Error("Modpack não encontrado no Modrinth");
        const project = await projectRes.json();
        const vers = versionsRes.ok ? await versionsRes.json() : [];

        setModpack({
          id: project.id,
          slug: project.slug,
          title: project.title,
          description: project.description,
          body: project.body || project.description,
          icon_url: project.icon_url || null,
          categories: project.categories || [],
          downloads: project.downloads || 0,
          followers: project.followers || 0,
          date_created: project.published,
          date_modified: project.updated,
          game_versions: project.game_versions || [],
          loaders: project.loaders || [],
          latest_version: vers[0] ? {
            id: vers[0].id,
            name: vers[0].name,
            version_number: vers[0].version_number,
            game_versions: vers[0].game_versions,
            loaders: vers[0].loaders,
            date_published: vers[0].date_published,
            downloads: vers[0].downloads,
            version_type: vers[0].version_type,
          } : null,
          author: project.author || undefined,
          url: `https://modrinth.com/modpack/${project.slug}`,
          gallery: project.gallery || [],
        });
        setVersions(vers.map((v: any) => ({
          id: v.id,
          name: v.name,
          version_number: v.version_number,
          game_versions: v.game_versions || [],
          loaders: v.loaders || [],
          date_published: v.date_published,
          downloads: v.downloads || 0,
          version_type: v.version_type,
          files: v.files,
        })));
      } else {
        // CurseForge - buscar pelo ID (slug pode ser o ID numérico)
        if (!curseforgeKey) {
          setError("Chave da API CurseForge não configurada.");
          setLoading(false);
          return;
        }
        const modId = /\d/.test(slug) ? slug : null;
        if (!modId) {
          setError("ID do modpack CurseForge inválido.");
          setLoading(false);
          return;
        }
        const [modRes, filesRes, descRes] = await Promise.all([
          fetch(`https://api.curseforge.com/v1/mods/${modId}`, { headers: { "x-api-key": curseforgeKey } }),
          fetch(`https://api.curseforge.com/v1/mods/${modId}/files?pageSize=50`, { headers: { "x-api-key": curseforgeKey } }),
          fetch(`https://api.curseforge.com/v1/mods/${modId}/description`, { headers: { "x-api-key": curseforgeKey } }),
        ]);
        if (!modRes.ok) throw new Error("Modpack não encontrado no CurseForge");
        const modData = await modRes.json();
        const mod = modData.data;
        const filesData = filesRes.ok ? await filesRes.json() : { data: [] };
        const descData = descRes.ok ? await descRes.json() : { data: "" };

        const loaderTypes: string[] = [];
        if (mod.latestFiles?.[0]?.gameVersions) {
          for (const gv of mod.latestFiles[0].gameVersions) {
            const lower = (gv || "").toLowerCase();
            if (LOADERS.includes(lower)) loaderTypes.push(lower);
          }
        }

        const mappedVersions = (filesData.data || []).map((f: any) => ({
          id: String(f.id),
          name: f.displayName,
          version_number: f.fileName,
          game_versions: (f.gameVersions || []).filter((v: string) => /^\d/.test(v)),
          loaders: (f.gameVersions || []).filter((v: string) => LOADERS.includes(v.toLowerCase())),
          date_published: f.fileDate,
          downloads: f.downloadCount || 0,
          version_type: f.releaseType === 1 ? "release" : f.releaseType === 2 ? "beta" : "alpha",
          files: [{ url: f.downloadUrl, size: f.fileLength, filename: f.fileName }],
        }));

        setModpack({
          id: String(mod.id),
          slug: mod.slug || String(mod.id),
          title: mod.name,
          description: mod.summary,
          body: descData.data || mod.summary,
          icon_url: mod.logo?.thumbnailUrl || null,
          categories: (mod.categories || []).map((c: any) => c.name),
          downloads: mod.downloadCount || 0,
          followers: mod.thumbsUpCount || 0,
          date_created: mod.dateCreated,
          date_modified: mod.dateModified,
          game_versions: (mod.latestFilesIndexes || []).map((f: any) => f.gameVersion).filter((v: string) => /^\d/.test(v)),
          loaders: loaderTypes,
          latest_version: mappedVersions[0] || null,
          url: mod.links?.websiteUrl || `https://www.curseforge.com/minecraft/modpacks/${mod.slug}`,
        });
        setVersions(mappedVersions);
      }
    } catch (err: any) {
      setError(err.message || "Erro ao carregar detalhes do modpack");
    } finally {
      setLoading(false);
    }
  };

  const installVersion = async (versionId: string) => {
    if (!serverId || !modpack) return;
    setInstalling(true);
    try {
      const response = await fetch(`/api/client/servers/${serverId}/modpack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modpack_slug: modpack.slug, version_id: versionId, provider }),
      });
      if (!response.ok) throw new Error();
      alert("Modpack agendado para instalação!");
    } catch {
      alert("Erro ao instalar modpack");
    } finally {
      setInstalling(false);
    }
  };

  const formatDownloads = (n?: number | null) => {
    if (!n) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  const formatDate = (d?: string) => {
    if (!d) return "N/A";
    const date = new Date(d);
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  };

  const timeAgo = (d?: string) => {
    if (!d) return "";
    const diff = Date.now() - new Date(d).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days < 1) return "hoje";
    if (days < 30) return `${days}d atrás`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo atrás`;
    return `${Math.floor(months / 12)}y atrás`;
  };

  if (loading) {
    return (
      <PageContentBlock title="Modpack" showFlashKey="server:modpacks">
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
        </div>
      </PageContentBlock>
    );
  }

  if (error || !modpack) {
    return (
      <PageContentBlock title="Modpack" showFlashKey="server:modpacks">
        <button onClick={() => history.goBack()} className="text-gray-400 hover:text-white flex items-center gap-2 mb-4">
          <FontAwesomeIcon icon={faArrowLeft} />
          Voltar
        </button>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
          <FontAwesomeIcon icon={faExclamationTriangle} className="text-red-400 text-3xl mb-3" />
          <p className="text-red-400 font-medium">{error || "Modpack não encontrado"}</p>
        </div>
      </PageContentBlock>
    );
  }

  return (
    <PageContentBlock title={modpack.title} showFlashKey="server:modpacks">
      {/* Back link */}
      <button onClick={() => history.goBack()} className="text-gray-400 hover:text-white flex items-center gap-2 mb-4 transition-colors">
        <FontAwesomeIcon icon={faArrowLeft} />
        <span>Back to Modpacks</span>
      </button>

      {/* Header */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 mb-6">
        <div className="flex items-start gap-4">
          <img
            src={modpack.icon_url || "/default-modpack.png"}
            alt={modpack.title}
            className="w-16 h-16 rounded-lg object-cover border border-gray-600 flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h1 className="text-xl font-bold text-white">{modpack.title}</h1>
                <p className="text-sm text-gray-400 mt-1">
                  {formatDownloads(modpack.downloads)} downloads · {modpack.latest_version ? (modpack.latest_version.name || modpack.latest_version.version_number) : "N/A"}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {modpack.url && (
                  <a
                    href={modpack.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                  >
                    <FontAwesomeIcon icon={faExternalLinkAlt} className="text-xs" />
                    Website
                  </a>
                )}
                <button
                  onClick={() => modpack.latest_version && installVersion(modpack.latest_version.id)}
                  disabled={!modpack.latest_version || !serverId || installing}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  <FontAwesomeIcon icon={installing ? faBox : faDownload} className="text-xs" />
                  {installing ? "Installing..." : "Install"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700 mb-6">
        <button
          onClick={() => setActiveTab("description")}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "description"
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-gray-400 hover:text-gray-300"
          }`}
        >
          Description
        </button>
        <button
          onClick={() => setActiveTab("versions")}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "versions"
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-gray-400 hover:text-gray-300"
          }`}
        >
          Versions ({versions.length})
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main content */}
        <div className="lg:col-span-3">
          {activeTab === "description" ? (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
              {/* Gallery images */}
              {modpack.gallery && modpack.gallery.length > 0 && (
                <div className="mb-6 space-y-4">
                  {modpack.gallery.map((img: string, idx: number) => (
                    <img key={idx} src={img} alt="" className="w-full rounded-lg border border-gray-700" />
                  ))}
                </div>
              )}
              {/* Body */}
              <div
                className="text-sm text-gray-300 leading-relaxed prose prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: modpack.body.replace(/\n/g, "<br/>") }}
              />
            </div>
          ) : (
            <div className="space-y-2">
              {versions.length === 0 ? (
                <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 text-center">
                  <p className="text-gray-400">Nenhuma versão encontrada</p>
                </div>
              ) : (
                versions.map((v) => (
                  <div
                    key={v.id}
                    className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center justify-between hover:border-gray-600 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white font-medium truncate">{v.name || v.version_number}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {(v.game_versions || []).slice(0, 3).join(", ")} · {(v.loaders || []).join(", ")}
                        {v.version_type && ` · ${v.version_type}`}
                      </p>
                    </div>
                    <button
                      onClick={() => installVersion(v.id)}
                      disabled={!serverId || installing}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ml-3 flex-shrink-0"
                    >
                      <FontAwesomeIcon icon={faDownload} className="text-[10px]" />
                      Install
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Categories */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Categories</h3>
            <div className="flex flex-wrap gap-1.5">
              {(modpack.categories || []).map((cat: string) => (
                <span key={cat} className="bg-gray-700/50 text-gray-300 px-2 py-1 rounded text-[11px]">
                  {cat}
                </span>
              ))}
              {(!modpack.categories || modpack.categories.length === 0) && (
                <span className="text-xs text-gray-500">Nenhuma categoria</span>
              )}
            </div>
          </div>

          {/* Server Loaders */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Server Loaders</h3>
            <div className="flex flex-wrap gap-1.5">
              {(modpack.loaders || []).map((loader: string) => (
                <span key={loader} className="bg-gray-700/50 text-gray-300 px-2 py-1 rounded text-[11px] capitalize">
                  {loader}
                </span>
              ))}
              {(!modpack.loaders || modpack.loaders.length === 0) && (
                <span className="text-xs text-gray-500">Nenhum loader</span>
              )}
            </div>
          </div>

          {/* Game Versions */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Game Versions</h3>
            <div className="flex flex-wrap gap-1.5">
              {(modpack.game_versions || []).slice(0, 8).map((v: string) => (
                <span key={v} className="bg-gray-700/50 text-gray-300 px-2 py-1 rounded text-[11px]">
                  {v}
                </span>
              ))}
              {(!modpack.game_versions || modpack.game_versions.length === 0) && (
                <span className="text-xs text-gray-500">Nenhuma versão</span>
              )}
            </div>
          </div>

          {/* Details */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Details</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <FontAwesomeIcon icon={faClock} className="text-gray-500 text-xs" />
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">Updated</p>
                  <p className="text-xs text-gray-300">{timeAgo(modpack.date_modified)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <FontAwesomeIcon icon={faCalendar} className="text-gray-500 text-xs" />
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">Published</p>
                  <p className="text-xs text-gray-300">{formatDate(modpack.date_created)}</p>
                </div>
              </div>
              {modpack.author && (
                <div className="flex items-center gap-2">
                  <FontAwesomeIcon icon={faCheck} className="text-gray-500 text-xs" />
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase">Author</p>
                    <p className="text-xs text-gray-300">{modpack.author}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageContentBlock>
  );
}
