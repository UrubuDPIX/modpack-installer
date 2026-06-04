import React, { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faKey,
  faSave,
  faCheck,
  faExclamationTriangle,
  faCog,
} from "@fortawesome/free-solid-svg-icons";

interface ModpackSettings {
  curseforge_api_key: string;
  modrinth_enabled: boolean;
  curseforge_enabled: boolean;
  default_loader: string;
}

export default function ModpackSettingsPage() {
  const [settings, setSettings] = useState<ModpackSettings>({
    curseforge_api_key: "",
    modrinth_enabled: true,
    curseforge_enabled: false,
    default_loader: "forge",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const fetchSettings = async () => {
    try {
      const response = await fetch("/api/admin/modpack-settings");
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      }
    } catch (err) {
      console.error("Erro ao carregar configurações");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/modpack-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        setMessage({
          type: "success",
          text: "Configurações salvas com sucesso!",
        });
      } else {
        setMessage({ type: "error", text: "Erro ao salvar configurações" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Erro na conexão" });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  if (loading) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        style={{ background: "#0f1115" }}
      >
        <div
          className="animate-spin rounded-full h-10 w-10 border-b-2"
          style={{ borderColor: "#3b82f6" }}
        ></div>
      </div>
    );
  }

  return (
    <div
      className="p-8"
      style={{
        maxWidth: 900,
        margin: "0 auto",
        background: "#0f1115",
        minHeight: "100vh",
      }}
    >
      <div className="mb-8">
        <h1
          className="text-2xl font-bold mb-2 flex items-center"
          style={{ color: "#fff" }}
        >
          <FontAwesomeIcon
            icon={faCog}
            className="mr-3"
            style={{ color: "#3b82f6" }}
          />
          Configurações do Modpack Installer
        </h1>
        <p style={{ color: "#6b7280", fontSize: 14 }}>
          Configure as APIs de busca de modpacks para os servidores
        </p>
      </div>

      {message && (
        <div
          className="mb-6 p-4 rounded-lg flex items-center gap-3"
          style={{
            background:
              message.type === "success"
                ? "rgba(34, 197, 94, 0.1)"
                : "rgba(239, 68, 68, 0.1)",
            border: `1px solid ${message.type === "success" ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
            color: message.type === "success" ? "#22c55e" : "#ef4444",
          }}
        >
          <FontAwesomeIcon
            icon={message.type === "success" ? faCheck : faExclamationTriangle}
          />
          {message.text}
        </div>
      )}

      {/* CurseForge API */}
      <div
        className="rounded-xl p-6 mb-6"
        style={{ background: "#1e2128", border: "1px solid #2a2e37" }}
      >
        <div className="flex items-center gap-3 mb-5">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(59, 130, 246, 0.1)" }}
          >
            <FontAwesomeIcon
              icon={faKey}
              style={{ color: "#3b82f6", fontSize: 18 }}
            />
          </div>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "#fff" }}>
              CurseForge API
            </h2>
            <p style={{ color: "#6b7280", fontSize: 13 }}>
              Obtenha sua chave em: https://console.curseforge.com/
            </p>
          </div>
        </div>

        <div className="mb-4">
          <label
            className="block mb-2 text-sm font-medium"
            style={{ color: "#a1a5b7" }}
          >
            Chave da API (API Key)
          </label>
          <div className="relative">
            <input
              type="password"
              value={settings.curseforge_api_key}
              onChange={(e) =>
                setSettings({ ...settings, curseforge_api_key: e.target.value })
              }
              placeholder="$2y$10$... sua chave aqui"
              className="w-full rounded-lg px-4 py-3 text-sm focus:outline-none"
              style={{
                background: "#1a1d24",
                border: "1px solid #2a2e37",
                color: "#fff",
              }}
            />
          </div>
          <p style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>
            A chave da API CurseForge permite buscar modpacks diretamente do
            CurseForge. Sem ela, apenas o Modrinth será usado.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="curseforge-enabled"
            checked={settings.curseforge_enabled}
            onChange={(e) =>
              setSettings({ ...settings, curseforge_enabled: e.target.checked })
            }
            className="w-4 h-4 rounded"
          />
          <label
            htmlFor="curseforge-enabled"
            style={{ color: "#a1a5b7", fontSize: 14 }}
          >
            Habilitar busca no CurseForge
          </label>
        </div>
      </div>

      {/* Modrinth */}
      <div
        className="rounded-xl p-6 mb-6"
        style={{ background: "#1e2128", border: "1px solid #2a2e37" }}
      >
        <div className="flex items-center gap-3 mb-5">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(34, 197, 94, 0.1)" }}
          >
            <FontAwesomeIcon
              icon={faCheck}
              style={{ color: "#22c55e", fontSize: 18 }}
            />
          </div>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "#fff" }}>
              Modrinth API
            </h2>
            <p style={{ color: "#6b7280", fontSize: 13 }}>
              API pública — não requer chave
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="modrinth-enabled"
            checked={settings.modrinth_enabled}
            onChange={(e) =>
              setSettings({ ...settings, modrinth_enabled: e.target.checked })
            }
            className="w-4 h-4 rounded"
          />
          <label
            htmlFor="modrinth-enabled"
            style={{ color: "#a1a5b7", fontSize: 14 }}
          >
            Habilitar busca no Modrinth
          </label>
        </div>
      </div>

      {/* Default Settings */}
      <div
        className="rounded-xl p-6 mb-6"
        style={{ background: "#1e2128", border: "1px solid #2a2e37" }}
      >
        <h2 className="text-lg font-semibold mb-4" style={{ color: "#fff" }}>
          Configurações Padrão
        </h2>

        <div>
          <label
            className="block mb-2 text-sm font-medium"
            style={{ color: "#a1a5b7" }}
          >
            Loader padrão
          </label>
          <select
            value={settings.default_loader}
            onChange={(e) =>
              setSettings({ ...settings, default_loader: e.target.value })
            }
            className="rounded-lg px-4 py-2.5 text-sm focus:outline-none"
            style={{
              background: "#1a1d24",
              border: "1px solid #2a2e37",
              color: "#fff",
              minWidth: 200,
            }}
          >
            <option value="forge">Forge</option>
            <option value="fabric">Fabric</option>
            <option value="neoforge">NeoForge</option>
            <option value="quilt">Quilt</option>
          </select>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all"
          style={{
            background: saving ? "#2a2e37" : "#3b82f6",
            color: "#fff",
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          <FontAwesomeIcon
            icon={saving ? faCog : faSave}
            className={saving ? "animate-spin" : ""}
          />
          {saving ? "Salvando..." : "Salvar Configurações"}
        </button>
      </div>
    </div>
  );
}
