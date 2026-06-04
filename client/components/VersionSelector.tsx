/* eslint-disable */
import React, { useState } from "react";
import { Modpack, ModpackVersion } from "./types";

interface VersionSelectorProps {
  modpack: Modpack;
  currentVersionId?: string;
  onSelect: (
    modpack: Modpack,
    version: ModpackVersion,
    action: "install" | "reinstall" | "downgrade" | "update",
  ) => void;
}

export default function VersionSelector({
  modpack,
  currentVersionId,
  onSelect,
}: VersionSelectorProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const getActionType = (
    versionId: string,
  ): "reinstall" | "update" | "downgrade" | "install" => {
    if (!currentVersionId) return "install";
    if (versionId === currentVersionId) return "reinstall";

    const currentIndex = modpack.versions.findIndex(
      (v) => v.id === currentVersionId,
    );
    const targetIndex = modpack.versions.findIndex((v) => v.id === versionId);

    if (targetIndex < currentIndex) return "update";
    return "downgrade";
  };

  const getActionButton = (version: ModpackVersion) => {
    const action = getActionType(version.id);

    const buttonConfig = {
      install: { label: "Instalar", className: "btn-install", icon: "↓" },
      reinstall: { label: "Reinstalar", className: "btn-reinstall", icon: "↻" },
      update: { label: "Atualizar", className: "btn-update", icon: "⬆" },
      downgrade: { label: "Downgrade", className: "btn-downgrade", icon: "⬇" },
    };

    const config = buttonConfig[action];

    return (
      <button
        className={`version-action-btn ${config.className}`}
        onClick={() => onSelect(modpack, version, action)}
      >
        <span className="btn-icon">{config.icon}</span>
        {config.label}
      </button>
    );
  };

  return (
    <div className="version-selector">
      <div
        className="version-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <img
          src={modpack.icon || "/default-modpack.png"}
          alt={modpack.name}
          className="version-modpack-icon"
        />
        <div className="version-header-info">
          <h4>{modpack.name}</h4>
          <p>{modpack.versions.length} versões disponíveis</p>
        </div>
        <span className={`expand-icon ${isExpanded ? "expanded" : ""}`}>▶</span>
      </div>

      {isExpanded && (
        <div className="versions-list">
          {modpack.versions.map((version) => {
            const isCurrent = version.id === currentVersionId;

            return (
              <div
                key={version.id}
                className={`version-item ${isCurrent ? "current" : ""}`}
              >
                <div className="version-info-row">
                  <div className="version-main">
                    <span className="version-name">{version.name}</span>
                    {isCurrent && <span className="current-badge">Atual</span>}
                    {version.isServerPack && (
                      <span className="server-pack-badge">Server Pack ✓</span>
                    )}
                  </div>

                  <div className="version-meta">
                    <span className="mc-version">
                      {version.minecraftVersion}
                    </span>
                    <span className="loader-type">
                      {version.loader} {version.loaderVersion}
                    </span>
                    <span className="file-size">{version.size}</span>
                    <span className="release-date">
                      {new Date(version.releasedAt).toLocaleDateString("pt-BR")}
                    </span>
                  </div>

                  <div className="version-actions">
                    <span
                      className={`release-tag ${version.isRelease ? "release" : "beta"}`}
                    >
                      {version.isRelease ? "release" : "beta"}
                    </span>
                    {getActionButton(version)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
