/* eslint-disable */
import React, { useState } from "react";
import { Modpack, ModpackVersion, ServerModpack } from "../types";
import VersionSelector from "./VersionSelector";
import InstallationModal from "./InstallationModal";

interface ModpackInstallerProps {
  serverId: string;
  serverModpack: ServerModpack | null;
  availableModpacks: Modpack[];
  onUpdate: () => void;
}

type InstallAction = "install" | "reinstall" | "downgrade" | "update";

export default function ModpackInstaller({
  serverId,
  serverModpack,
  availableModpacks,
  onUpdate,
}: ModpackInstallerProps) {
  const [selectedModpack, setSelectedModpack] = useState<Modpack | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<ModpackVersion | null>(
    null,
  );
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [installAction, setInstallAction] = useState<InstallAction>("install");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleVersionSelect = (
    modpack: Modpack,
    version: ModpackVersion,
    action: InstallAction,
  ) => {
    setSelectedModpack(modpack);
    setSelectedVersion(version);
    setInstallAction(action);
    setIsModalOpen(true);
  };

  const handleInstall = async () => {
    if (!selectedModpack || !selectedVersion) return;

    setIsProcessing(true);
    try {
      const response = await fetch(`/api/servers/${serverId}/modpack/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modpackId: selectedModpack.id,
          versionId: selectedVersion.id,
          action: installAction,
        }),
      });

      if (response.ok) {
        setIsModalOpen(false);
        onUpdate();
      } else {
        const error = await response.json();
        alert(error.message || "Erro ao instalar modpack");
      }
    } catch (err) {
      alert("Erro na conexão com o servidor");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUninstall = async () => {
    if (!serverModpack) return;

    if (!confirm("Tem certeza que deseja desinstalar o modpack atual?")) return;

    setIsProcessing(true);
    try {
      const response = await fetch(
        `/api/servers/${serverId}/modpack/uninstall`,
        {
          method: "DELETE",
        },
      );

      if (response.ok) {
        onUpdate();
      } else {
        alert("Erro ao desinstalar modpack");
      }
    } catch (err) {
      alert("Erro na conexão");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="modpack-installer">
      {serverModpack && (
        <div className="installed-modpack-card">
          <div className="modpack-info">
            <img
              src={serverModpack.modpack.icon || "/default-modpack.png"}
              alt={serverModpack.modpack.name}
              className="modpack-icon"
            />
            <div className="modpack-details">
              <h3>{serverModpack.modpack.name}</h3>
              <p className="modpack-author">
                by {serverModpack.modpack.author}
              </p>
              <div className="install-badge installed">
                <span className="check-icon">✓</span> Instalado
              </div>
              <p className="downloads">
                {serverModpack.modpack.downloads.toLocaleString()} downloads
              </p>
            </div>
          </div>

          <div className="install-status">
            <div className="status-header success">
              <span className="status-icon">✓</span>
              <span>Este modpack está instalado no seu servidor</span>
            </div>
            <div className="version-info">
              <p>
                Versão atual: <strong>{serverModpack.version.name}</strong>
              </p>
              <p className="install-date">
                Instalado em{" "}
                {new Date(serverModpack.installedAt).toLocaleDateString(
                  "pt-BR",
                )}
              </p>
            </div>
            <div className="version-legend">
              <span className="legend-item">
                <span className="icon update">⬆</span> Atualizar = mais recente
              </span>
              <span className="legend-item">
                <span className="icon downgrade">⬇</span> Downgrade = anterior
              </span>
              <span className="legend-item">
                <span className="icon reinstall">↻</span> Reinstalar = mesma
                versão
              </span>
            </div>
          </div>

          <button
            className="uninstall-btn"
            onClick={handleUninstall}
            disabled={isProcessing}
          >
            Desinstalar
          </button>
        </div>
      )}

      <div className="version-selector-section">
        <h2>Selecione uma versão</h2>

        {availableModpacks.map((modpack) => (
          <VersionSelector
            key={modpack.id}
            modpack={modpack}
            currentVersionId={serverModpack?.version.id}
            onSelect={handleVersionSelect}
          />
        ))}
      </div>

      {isModalOpen && selectedModpack && selectedVersion && (
        <InstallationModal
          modpack={selectedModpack}
          version={selectedVersion}
          action={installAction}
          isProcessing={isProcessing}
          onConfirm={handleInstall}
          onCancel={() => setIsModalOpen(false)}
        />
      )}
    </div>
  );
}
