/* eslint-disable */
import React, { useState, useEffect, useRef } from "react";
import InstallProgressModal from "./InstallProgressModal";
import { useHistory, useRouteMatch } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faDownload,
  faBox,
  faCheck,
  faExclamationTriangle,
  faSearch,
  faCog,
  faInfoCircle,
  faTimes,
  faExternalLinkAlt,
} from "@fortawesome/free-solid-svg-icons";
// @ts-ignore
import { ServerContext } from '@/state/server';

interface ModpackItem {
  id?: string | number;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  categories: string[];
  downloads: number;
  followers: number;
  date_created: string;
  game_versions: string[];
  loaders: string[];
  latest_version: any | null;
  body?: string;
  author?: string;
  url?: string;
}

const CATEGORIES = [
  { key: "adventure", label: "Adventure" },
  { key: "combat", label: "Combat / PvP" },
  { key: "exploration", label: "Exploration" },
  { key: "hardcore", label: "Hardcore" },
  { key: "kitchen-sink", label: "Kitchen Sink" },
  { key: "lightweight", label: "Lightweight" },
  { key: "magic", label: "Magic" },
  { key: "multiplayer", label: "Multiplayer" },
  { key: "quests", label: "Quests" },
  { key: "technology", label: "Technology" },
];

const LOADERS = ["forge", "fabric", "quilt", "neoforge"];

const MINECRAFT_VERSIONS = [
  "1.21.4","1.21.1","1.20.6","1.20.4","1.20.1","1.19.4","1.19.2","1.18.2","1.16.5","1.12.2","1.7.10"
];

// CurseForge category IDs for modpacks (classId 4471)
const CF_CATEGORY_MAP: Record<string, number> = {
  adventure: 4472,
  combat: 4473,
  exploration: 4475,
  hardcore: 4476,
  magic: 4478,
  multiplayer: 4479,
  "kitchen-sink": 4481,
  technology: 4482,
  lightweight: 4483,
  quests: 4484,
};

// CurseForge modLoaderType enum
const CF_LOADER_MAP: Record<string, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};

// CurseForge sortField enum
const CF_SORT_MAP: Record<string, number> = {
  relevance: 2,  // Popularity (same as CF website default)
  downloads: 6,  // TotalDownloads
  follows: 2,    // Popularity
  newest: 3,     // LastUpdated
};

export default function ModpacksContainer() {
  const history = useHistory();
  const match = useRouteMatch();
  const id = ServerContext.useStoreState((state: any) => state.server.data?.uuid);

  const [provider, setProvider] = useState<"modrinth" | "curseforge">(() => {
    const stored = localStorage.getItem("modpack_provider");
    return stored === "curseforge" ? "curseforge" : "modrinth";
  });
  const [modpacks, setModpacks] = useState<ModpackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedLoader, setSelectedLoader] = useState("");
  const [selectedVersion, setSelectedVersion] = useState("");
  const [sortBy, setSortBy] = useState<"relevance" | "downloads" | "follows" | "newest">("relevance");
  const [installedModpack, setInstalledModpack] = useState<any>(null);
  const [curseforgeKey, setCurseforgeKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);

  // Install modal states
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installModpackSlug, setInstallModpackSlug] = useState<string | null>(null);
  const [installVersionId, setInstallVersionId] = useState<string | null>(null);
  const [installModpackTitle, setInstallModpackTitle] = useState<string | null>(null);
  const [installModpackIcon, setInstallModpackIcon] = useState<string | null>(null);
  const [installModpackDownloads, setInstallModpackDownloads] = useState<number>(0);
  const [deleteServerFiles, setDeleteServerFiles] = useState(false);
  const [acceptEula, setAcceptEula] = useState(false);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [progressModpackTitle, setProgressModpackTitle] = useState('');
  const [installingVersion, setInstallingVersion] = useState<string | null>(null);

  // Update Modal states
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateVersions, setUpdateVersions] = useState<any[]>([]);
  const [updateVersionId, setUpdateVersionId] = useState("");
  const [fetchingVersions, setFetchingVersions] = useState(false);

  // Use ref to always have current provider in async callbacks
  const providerRef = useRef(provider);
  providerRef.current = provider;

  useEffect(() => {
    const saved = localStorage.getItem("modpack_curseforge_key");
    if (saved) setCurseforgeKey(saved);
  }, []);

  // Fetch installed modpack metadata
  useEffect(() => {
    if (!id) return;
    fetch(`/api/client/servers/${id}/modpack/metadata`)
      .then(res => {
        if (!res.ok) throw new Error('No modpack');
        return res.json();
      })
      .then(data => setInstalledModpack(data))
      .catch(() => setInstalledModpack(null));
  }, [id]);

  // Busca CurseForge automaticamente quando a chave é carregada
  useEffect(() => {
    if (provider === "curseforge" && curseforgeKey) {
      fetchCurseforgeModpacks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curseforgeKey]);

  // ── Modrinth ──────────────────────────────────────────────────────────

  const fetchModrinthModpacks = async (append = false, targetPage = 0) => {
    try {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      const facets: string[] = [JSON.stringify(["project_type:modpack"])];
      if (selectedCategory) facets.push(JSON.stringify(["categories:" + selectedCategory]));
      if (selectedLoader) facets.push(JSON.stringify(["categories:" + selectedLoader]));
      if (selectedVersion) facets.push(JSON.stringify(["versions:" + selectedVersion]));

      const facetStr = "[" + facets.join(",") + "]";
      const offset = targetPage * 50;
      const url =
        `https://api.modrinth.com/v2/search?` +
        `query=${encodeURIComponent(searchQuery || "")}` +
        `&index=${sortBy}` +
        `&offset=${offset}` +
        `&limit=50` +
        `&facets=${encodeURIComponent(facetStr)}`;

      const response = await fetch(url);
      if (!response.ok) throw new Error("Erro ao buscar modpacks");
      const data = await response.json();
      const hits: any[] = data.hits || [];

      const mapped: ModpackItem[] = hits.map((hit: any) => {
        const allCats: string[] = hit.categories || [];
        const loaderSet = new Set(LOADERS);
        const realCategories = allCats.filter((c: string) => !loaderSet.has(c));
        const loaders = allCats.filter((c: string) => loaderSet.has(c));

        return {
          id: hit.project_id || hit.slug,
          slug: hit.slug || hit.project_id,
          title: hit.title,
          description: hit.description,
          icon_url: hit.icon_url || null,
          categories: hit.display_categories || realCategories,
          downloads: hit.downloads || 0,
          followers: hit.follows || 0,
          date_created: hit.date_created,
          game_versions: hit.versions || [],
          loaders: loaders,
          latest_version: null,
        };
      });

      const enriched = await Promise.all(
        mapped.slice(0, 20).map(async (mp) => {
          try {
            const vRes = await fetch(`https://api.modrinth.com/v2/project/${mp.slug}/version?limit=1`);
            if (!vRes.ok) return mp;
            const versions = await vRes.json();
            return { ...mp, latest_version: versions[0] || null };
          } catch {
            return mp;
          }
        })
      );

      const rest = mapped.slice(20).map((mp) => ({ ...mp, latest_version: null }));
      const all = [...enriched, ...rest];

      if (providerRef.current === "modrinth") {
        if (append) {
          setModpacks((prev) => [...prev, ...all]);
        } else {
          setModpacks(all);
        }
        setHasMore(hits.length === 50);
      }
    } catch (err) {
      if (providerRef.current === "modrinth") {
        setError("Não foi possível carregar os modpacks do Modrinth");
      }
    } finally {
      if (providerRef.current === "modrinth") {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  // ── CurseForge ────────────────────────────────────────────────────────

  const fetchCurseforgeModpacks = async (append = false, targetPage = 0) => {
    if (!curseforgeKey) {
      setError("Chave de API do CurseForge não configurada. Clique em ⚙ para adicionar.");
      setLoading(false);
      setModpacks([]);
      return;
    }
    try {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      const hasSearch = searchQuery.trim().length > 0;
      const pageSize = 50;
      const sortField = hasSearch ? 2 : (CF_SORT_MAP[sortBy] || 2);
      const index = targetPage * pageSize;

      let url = `https://api.curseforge.com/v1/mods/search?gameId=432&classId=4471&pageSize=${pageSize}&index=${index}`;
      if (searchQuery) url += `&searchFilter=${encodeURIComponent(searchQuery.trim())}`;
      if (selectedVersion) url += `&gameVersion=${encodeURIComponent(selectedVersion)}`;
      if (selectedLoader && CF_LOADER_MAP[selectedLoader]) {
        url += `&modLoaderType=${CF_LOADER_MAP[selectedLoader]}`;
      }
      if (!hasSearch && selectedCategory && CF_CATEGORY_MAP[selectedCategory]) {
        url += `&categoryId=${CF_CATEGORY_MAP[selectedCategory]}`;
      }
      url += `&sortField=${sortField}`;
      url += `&sortOrder=desc`;

      const response = await fetch(url, {
        headers: { "x-api-key": curseforgeKey },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 100)}`);
      }
      const data = await response.json();

      let hits: ModpackItem[] = (data.data || []).map((mod: any) => {
        const loaderTypes: string[] = [];
        if (mod.latestFiles?.[0]?.gameVersions) {
          for (const gv of mod.latestFiles[0].gameVersions) {
            const lower = (gv || "").toLowerCase();
            if (LOADERS.includes(lower)) loaderTypes.push(lower);
          }
        }

        return {
          id: String(mod.id),
          slug: mod.slug || String(mod.id),
          title: mod.name,
          description: mod.summary,
          icon_url: mod.logo?.thumbnailUrl || null,
          categories: (mod.categories || []).map((c: any) => c.name),
          downloads: mod.downloadCount || 0,
          followers: mod.thumbsUpCount || 0,
          date_created: mod.dateCreated,
          game_versions: (mod.latestFilesIndexes || [])
            .map((f: any) => f.gameVersion)
            .filter((v: string) => v && /^\d/.test(v))
            .slice(0, 5),
          loaders: loaderTypes,
          latest_version: mod.latestFiles?.[0]
            ? {
                id: String(mod.latestFiles[0].id),
                name: mod.latestFiles[0].displayName,
                version_number: mod.latestFiles[0].fileName,
                game_versions: (mod.latestFiles[0].gameVersions || []).filter((v: string) => /^\d/.test(v)),
                loaders: loaderTypes,
                files: [{
                  url: mod.latestFiles[0].downloadUrl,
                  size: mod.latestFiles[0].fileLength,
                  filename: mod.latestFiles[0].fileName,
                }],
                date_published: mod.latestFiles[0].fileDate,
                downloads: 0,
                version_type: "release",
              }
            : null,
        };
      });

      if (hasSearch && searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase().replace(/\s+/g, " ");
        const qTokens = q.split(/\s+/);
        hits.sort((a: ModpackItem, b: ModpackItem) => {
          const aTitle = a.title.toLowerCase();
          const bTitle = b.title.toLowerCase();
          const aExact = aTitle === q ? 100 : aTitle.includes(q) ? 50 : 0;
          const bExact = bTitle === q ? 100 : bTitle.includes(q) ? 50 : 0;
          if (aExact !== bExact) return bExact - aExact;
          const aTokens = qTokens.filter((t: string) => aTitle.includes(t)).length;
          const bTokens = qTokens.filter((t: string) => bTitle.includes(t)).length;
          if (aTokens !== bTokens) return bTokens - aTokens;
          return (b.downloads || 0) - (a.downloads || 0);
        });
      }

      if (providerRef.current === "curseforge") {
        if (append) {
          setModpacks((prev) => [...prev, ...hits]);
        } else {
          setModpacks(hits);
        }
        setHasMore((data.data || []).length === pageSize);
      }
    } catch (err: any) {
      if (providerRef.current === "curseforge") {
        const status = err?.message?.includes("403") ? " (Chave inválida/expirada)" :
                       err?.message?.includes("429") ? " (Muitas requisições - aguarde)" :
                       err?.message?.includes("5") ? " (Erro no servidor CurseForge)" : "";
        setError(`Erro ao carregar CurseForge${status}. Verifique sua chave de API.`);
        console.error("[CurseForge Error]", err);
      }
    } finally {
      if (providerRef.current === "curseforge") {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  // ── Fetch dispatcher ──────────────────────────────────────────────────

  const fetchModpacks = () => {
    setPage(0);
    setHasMore(true);
    if (provider === "modrinth") fetchModrinthModpacks(false, 0);
    else fetchCurseforgeModpacks(false, 0);
  };

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    if (provider === "modrinth") fetchModrinthModpacks(true, nextPage);
    else fetchCurseforgeModpacks(true, nextPage);
  };

  const fetchInstalledModpack = async () => {
    try {
      const response = await fetch(`/api/client/servers/${id}/modpack`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.server_modpack) setInstalledModpack(data);
    } catch {
      // no installed modpack
    }
  };

  useEffect(() => {
    // Não busca CurseForge automaticamente se a chave ainda não foi carregada
    if (provider === "curseforge" && !curseforgeKey) return;
    fetchModpacks();
    if (id) fetchInstalledModpack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, provider, selectedCategory, selectedLoader, selectedVersion, sortBy]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchModpacks();
  };

  const openInstallModal = (modpack: ModpackItem) => {
    if (!modpack.latest_version || !modpack.latest_version.id) return;
    setInstallModpackSlug(modpack.slug);
    setInstallVersionId(modpack.latest_version.id);
    setInstallModpackTitle(modpack.title);
    setInstallModpackIcon(modpack.icon_url);
    setInstallModpackDownloads(modpack.downloads);
    setDeleteServerFiles(false);
    setAcceptEula(false);
    setShowInstallModal(true);
  };

  const handleInstall = async () => {
    if (!id || !installModpackSlug || !installVersionId) return;
    if (!acceptEula) {
      alert("Você deve aceitar o Minecraft EULA para continuar.");
      return;
    }
    setInstallingVersion(installVersionId);
    setShowInstallModal(false);
    setShowProgressModal(true);
    setProgressModpackTitle(installModpackTitle || 'Modpack');
    try {
      const response = await fetch(`/api/client/servers/${id}/modpack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modpack_slug: installModpackSlug,
          version_id: installVersionId,
          provider,
          delete_files: deleteServerFiles,
          accept_eula: acceptEula,
        }),
      });
      if (!response.ok) {
        console.error('Erro ao iniciar instalação:', await response.text());
        // Não fecha o modal - deixa o usuário ver o erro
      }
    } catch (err) {
      console.error('Erro na requisição:', err);
      // Não fecha o modal em caso de erro
    }
    // O modal vai fazer polling automático para acompanhar o progresso
  };

  const formatDownloads = (n?: number | null) => {
    if (!n) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  const saveCurseforgeKey = () => {
    localStorage.setItem("modpack_curseforge_key", curseforgeKey);
    setShowKeyInput(false);
    if (provider === "curseforge") fetchCurseforgeModpacks();
  };

  const switchProvider = (p: "modrinth" | "curseforge") => {
    localStorage.setItem("modpack_provider", p);
    setProvider(p);
    setModpacks([]);
    setError(null);
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} min atrás`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h atrás`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d atrás`;
    const months = Math.floor(days / 30);
    return `${months} meses atrás`;
  };

  const openUpdateModal = async () => {
    setShowUpdateModal(true);
    setFetchingVersions(true);
    setUpdateVersions([]);
    
    // Fallback: se o ID for muito pequeno (id do banco), tenta buscar os metadados reais primeiro
    let modpackId = installedModpack.id;
    if (/^\d+$/.test(modpackId) && modpackId.length < 5 && id) {
      try {
        const metaRes = await fetch(`/api/client/servers/${id}/modpack/metadata`);
        if (metaRes.ok) {
          const meta = await metaRes.json();
          if (meta.id) modpackId = meta.id;
        }
      } catch (e) {
        console.error("Falha ao atualizar metadados:", e);
      }
    }

    try {
      if ((installedModpack.provider || '').toLowerCase() === 'modrinth') {
        const res = await fetch(`https://api.modrinth.com/v2/project/${modpackId}/version`);
        if (!res.ok) throw new Error(`Modrinth API Error: ${res.status}`);
        const data = await res.json();
        setUpdateVersions(data.map((v: any) => ({
          id: v.id,
          name: v.name || v.version_number,
          game_versions: v.game_versions
        })));
      } else {
        if (!curseforgeKey) {
          alert("Chave do CurseForge não configurada! Insira a chave nas configurações primeiro.");
          setFetchingVersions(false);
          return;
        }
        const res = await fetch(`https://api.curseforge.com/v1/mods/${modpackId}/files?pageSize=50`, {
          headers: { "x-api-key": curseforgeKey, "Accept": "application/json" }
        });
        if (!res.ok) throw new Error(`CurseForge API Error: ${res.status} - ${await res.text()}`);
        const data = await res.json();
        if (!data.data || !Array.isArray(data.data)) {
          throw new Error("Formato de resposta inválido do CurseForge");
        }
        setUpdateVersions(data.data.map((f: any) => ({
          id: String(f.id),
          name: f.displayName || f.fileName,
          game_versions: f.gameVersions
        })));
      }
    } catch (e: any) {
      console.error(e);
      alert(`Falha ao buscar versões: ${e.message}`);
    } finally {
      setFetchingVersions(false);
    }
  };

  const handleUpdate = async () => {
    if (!id || !updateVersionId || !installedModpack) return;
    setInstallingVersion(updateVersionId);
    setShowUpdateModal(false);
    setShowProgressModal(true);
    setProgressModpackTitle(installedModpack.name);
    try {
      const response = await fetch(`/api/client/servers/${id}/modpack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modpack_slug: installedModpack.id, // Curseforge ID ou Modrinth slug
          version_id: updateVersionId,
          provider: installedModpack.provider,
          delete_files: false, // Update mode!
          accept_eula: true,
        }),
      });
      if (!response.ok) {
        console.error('Erro ao iniciar atualização:', await response.text());
      }
    } catch (err) {
      console.error('Erro na requisição:', err);
    }
  };

  return (
    <>
    <div className="p-6" style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Installed Modpack Banner */}
      {installedModpack && (
        <div style={{
          background: '#1A1C23',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '24px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
        }}>
          <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '1px', color: '#94A3B8', marginBottom: '16px', textTransform: 'uppercase' }}>
            Most Recently Installed Modpack
          </div>
          
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', paddingBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            {installedModpack.icon ? (
              <img
                src={installedModpack.icon}
                alt={installedModpack.name}
                style={{ width: 64, height: 64, borderRadius: '12px', objectFit: 'cover', flexShrink: 0, border: '2px solid rgba(255,255,255,0.05)' }}
              />
            ) : (
              <div style={{ width: 64, height: 64, borderRadius: '12px', background: 'rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '2px solid rgba(255,255,255,0.05)' }}>
                <FontAwesomeIcon icon={faBox} style={{ fontSize: 24, color: '#818cf8' }} />
              </div>
            )}
            
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                <span style={{ fontSize: '20px', fontWeight: 700, color: '#F8FAFC' }}>{installedModpack.name}</span>
                <span style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: 'rgba(255,255,255,0.05)',
                  color: '#94A3B8',
                  textTransform: 'capitalize',
                  border: '1px solid rgba(255,255,255,0.05)'
                }}>
                  {installedModpack.provider}
                </span>
              </div>
              <p style={{ fontSize: '14px', color: '#CBD5E1', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {installedModpack.description || 'Nenhuma descrição disponível para este modpack.'}
              </p>
            </div>
            
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <a
                href={installedModpack.provider === 'curseforge'
                  ? `https://www.curseforge.com/minecraft/modpacks/${installedModpack.id}`
                  : `https://modrinth.com/modpack/${installedModpack.id}`
                }
                target="_blank"
                rel="noreferrer"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  color: '#CBD5E1',
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textDecoration: 'none'
                }}
                className="hover:bg-gray-700"
                title="Ver no site"
              >
                <FontAwesomeIcon icon={faExternalLinkAlt} />
              </a>
              <button
                onClick={openUpdateModal}
                style={{
                  background: '#818CF8',
                  borderRadius: '8px',
                  padding: '10px 16px',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  border: 'none'
                }}
                className="hover:bg-indigo-500"
              >
                <FontAwesomeIcon icon={faCog} /> Change Version
              </button>
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', fontSize: '13px', color: '#94A3B8', paddingTop: '16px' }}>
            {installedModpack.version && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FontAwesomeIcon icon={faBox} style={{ opacity: 0.7 }} /> {installedModpack.name} - {installedModpack.version}
              </span>
            )}
            {installedModpack.installedAt && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FontAwesomeIcon icon={faCheck} style={{ opacity: 0.7 }} /> Installed {timeAgo(installedModpack.installedAt)}
              </span>
            )}
            {installedModpack.loader && (
              <span>Loader: {installedModpack.loader.toUpperCase()}</span>
            )}
            {installedModpack.minecraftVersion && (
              <span>Version: {installedModpack.minecraftVersion}</span>
            )}
          </div>
        </div>
      )}
      {/* Header with provider switcher */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center">
            <FontAwesomeIcon icon={faBox} className="mr-3" />
            Modpacks Disponíveis
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Descubra e instale modpacks no seu servidor Minecraft
          </p>
        </div>

        {/* Provider switcher */}
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
            <button
              onClick={() => switchProvider("modrinth")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${provider === "modrinth" ? "bg-green-600 text-white" : "text-gray-400 hover:text-white"}`}
            >
              Modrinth
            </button>
            <button
              onClick={() => switchProvider("curseforge")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${provider === "curseforge" ? "bg-orange-600 text-white" : "text-gray-400 hover:text-white"}`}
            >
              CurseForge
            </button>
          </div>
          {provider === "curseforge" && (
            <button
              onClick={() => setShowKeyInput(!showKeyInput)}
              title="Configurar chave API do CurseForge"
              className="bg-gray-800 border border-gray-700 hover:border-orange-500 text-gray-400 hover:text-orange-400 p-2 rounded-lg transition-colors"
            >
              <FontAwesomeIcon icon={faCog} />
            </button>
          )}
        </div>
      </div>

      {/* CurseForge API Key input */}
      {showKeyInput && provider === "curseforge" && (
        <div className="bg-gray-800 border border-orange-700/50 rounded-xl p-4 mb-4">
          <p className="text-sm text-gray-300 mb-1 font-medium">🔑 Chave de API do CurseForge</p>
          <p className="text-xs text-gray-500 mb-3">
            Obtenha sua chave em{" "}
            <a href="https://console.curseforge.com/" target="_blank" rel="noreferrer" className="text-orange-400 hover:underline">
              console.curseforge.com
            </a>
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={curseforgeKey}
              onChange={(e) => setCurseforgeKey(e.target.value)}
              placeholder="$2a$10$..."
              className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
            />
            <button
              onClick={saveCurseforgeKey}
              className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Salvar
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-200 p-3 rounded mb-4 flex items-center text-sm">
          <FontAwesomeIcon icon={faExclamationTriangle} className="mr-2" />
          {error}
        </div>
      )}



      {/* Filters */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <FontAwesomeIcon icon={faSearch} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 text-sm" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar modpacks..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            Buscar
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500">
            <option value="">Todas Categorias</option>
            {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <select value={selectedLoader} onChange={(e) => setSelectedLoader(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500">
            <option value="">Todos Loaders</option>
            {LOADERS.map((l) => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
          </select>
          <select value={selectedVersion} onChange={(e) => setSelectedVersion(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500">
            <option value="">Todas Versões</option>
            {MINECRAFT_VERSIONS.map((v) => <option key={v} value={v}>MC {v}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500">
            <option value="relevance">Relevância</option>
            <option value="downloads">Mais Downloads</option>
            <option value="follows">Mais Populares</option>
            <option value="newest">Mais Recentes</option>
          </select>
        </div>
      </form>

      {/* Popular categories */}
      {!selectedCategory && !searchQuery && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Categorias Populares</h3>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.slice(0, 6).map((cat) => (
              <button key={cat.key} onClick={() => setSelectedCategory(cat.key)} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-blue-500 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg text-xs transition-all">
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
          <p className="text-sm text-gray-500">Tente ajustar os filtros ou termos de busca.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {modpacks.map((modpack) => (
              <div key={modpack.slug} className="bg-gray-800 border border-gray-700 rounded-xl p-4 hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/10 transition-all group">
                <div className="flex items-start gap-3 mb-3">
                  <img src={modpack.icon_url || "/default-modpack.png"} alt={modpack.title} className="w-12 h-12 rounded-lg object-cover border border-gray-600 flex-shrink-0" onError={(e: any) => { e.target.style.display = "none"; }} />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate group-hover:text-blue-400 transition-colors">{modpack.title}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{formatDownloads(modpack.downloads)} downloads</p>
                  </div>
                </div>
                <p className="text-xs text-gray-400 line-clamp-2 mb-3 h-8">{modpack.description}</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {(modpack.categories || []).slice(0, 3).map((cat: string) => (
                    <span key={cat} className="bg-gray-700/50 text-gray-300 px-2 py-0.5 rounded text-[10px] uppercase tracking-wide">{cat}</span>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-gray-700/50">
                  <div className="flex flex-col gap-0.5">
                    {(modpack.game_versions || []).slice(0, 1).map((v: string) => <span key={v} className="text-[10px] text-gray-500">MC {v}</span>)}
                    {(modpack.loaders || []).slice(0, 1).map((l: string) => <span key={l} className="text-[10px] text-gray-500 capitalize">{l}</span>)}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const detailsSlug = provider === "curseforge" ? String(modpack.id) : modpack.slug;
                        history.push(`${match.url}/${detailsSlug}?provider=${provider}`);
                      }}
                      className="bg-gray-700 hover:bg-gray-600 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <FontAwesomeIcon icon={faInfoCircle} className="text-[10px]" />
                      Details
                    </button>
                    <button
                      onClick={() => openInstallModal(modpack)}
                      disabled={!modpack.latest_version || !id}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <FontAwesomeIcon icon={faDownload} className="text-[10px]" />
                      Install
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center mt-6">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {loadingMore ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                    Carregando...
                  </>
                ) : (
                  <>Carregar mais modpacks</>
                )}
              </button>
            </div>
          )}
        </>
      )}

    </div>

    {/* Install Modal */}
    {showInstallModal && installVersionId && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
          {/* Header */}
          <div className="flex items-start gap-4 p-6 border-b border-gray-700">
            <img
              src={installModpackIcon || "/default-modpack.png"}
              alt={installModpackTitle || ""}
              className="w-14 h-14 rounded-lg object-cover border border-gray-600 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-white truncate">{installModpackTitle}</h2>
              <p className="text-sm text-gray-400 mt-1">
                {formatDownloads(installModpackDownloads)} downloads
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="p-6 space-y-5">
            {/* Selected version */}
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Selected Version</h3>
              <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-3">
                <p className="text-sm text-white font-medium">{modpacks.find((m) => m.slug === installModpackSlug)?.latest_version?.name || modpacks.find((m) => m.slug === installModpackSlug)?.latest_version?.version_number || "Latest"}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {(modpacks.find((m) => m.slug === installModpackSlug)?.latest_version?.game_versions || []).slice(0, 3).join(", ")} · {(modpacks.find((m) => m.slug === installModpackSlug)?.latest_version?.loaders || []).join(", ")}
                </p>
              </div>
            </div>

            {/* Delete server files */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative flex items-center">
                <input
                  type="checkbox"
                  checked={deleteServerFiles}
                  onChange={(e) => setDeleteServerFiles(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-gray-700 rounded-full peer-checked:bg-red-500 transition-colors" />
                <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Delete Server Files</p>
                <p className="text-xs text-gray-400">This will erase all files from your server before installing the modpack. This cannot be undone.</p>
              </div>
            </label>

            {/* Accept EULA */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative flex items-center">
                <input
                  type="checkbox"
                  checked={acceptEula}
                  onChange={(e) => setAcceptEula(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-gray-700 rounded-full peer-checked:bg-blue-500 transition-colors" />
                <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Accept Minecraft EULA</p>
                <p className="text-xs text-gray-400">By enabling this option you are indicating your agreement to the Minecraft EULA.</p>
              </div>
            </label>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-700 bg-gray-800/50">
            <button
              onClick={() => setShowInstallModal(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleInstall}
              disabled={!acceptEula || installingVersion === installVersionId}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
            >
              <FontAwesomeIcon icon={faDownload} className="text-xs" />
              {installingVersion === installVersionId ? "Installing..." : "Install"}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Progress Modal */}
    <InstallProgressModal
      modpackTitle={progressModpackTitle}
      isOpen={showProgressModal}
      onClose={() => setShowProgressModal(false)}
      serverId={id || ''}
    />

    {/* Update Modal */}
    {showUpdateModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
          <div className="flex items-start gap-4 p-6 border-b border-gray-700">
            <img
              src={installedModpack.icon || "/default-modpack.png"}
              alt={installedModpack.name}
              className="w-14 h-14 rounded-lg object-cover border border-gray-600 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-white truncate">Atualizar {installedModpack.name}</h2>
              <p className="text-sm text-gray-400 mt-1">
                Versão Instalada: {installedModpack.version}
              </p>
            </div>
          </div>
          
          <div className="p-6">
            {fetchingVersions ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
              </div>
            ) : (
              <select
                value={updateVersionId}
                onChange={(e) => setUpdateVersionId(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="" disabled>Selecione uma versão...</option>
                {updateVersions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} {v.game_versions && `(MC ${v.game_versions.slice(0,2).join(', ')})`}
                  </option>
                ))}
              </select>
            )}
            
            <div className="mt-6 bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-4 flex gap-3">
              <FontAwesomeIcon icon={faInfoCircle} className="text-indigo-400 mt-0.5" />
              <p className="text-sm text-indigo-200">
                A atualização não irá deletar a pasta <code className="text-indigo-300">world</code>, <code className="text-indigo-300">logs</code> ou arquivos de jogadores.
              </p>
            </div>
          </div>
          
          <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-700 bg-gray-800/50">
            <button
              onClick={() => setShowUpdateModal(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleUpdate}
              disabled={!updateVersionId}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
            >
              <FontAwesomeIcon icon={faDownload} className="text-xs" />
              Atualizar
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
