import React from "react";
import { Modpack, ModpackVersion } from "../types";

interface InstallationModalProps {
  modpack: Modpack;
  version: ModpackVersion;
  action: "install" | "reinstall" | "downgrade" | "update";
  isProcessing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function InstallationModal({
  modpack,
  version,
  action,
  isProcessing,
  onConfirm,
  onCancel,
}: InstallationModalProps) {
  const actionLabels = {
    install: "Instalar",
    reinstall: "Reinstalar",
    downgrade: "Fazer Downgrade",
    update: "Atualizar",
  };

  const actionMessages = {
    install: "Este modpack será instalado no seu servidor.",
    reinstall:
      "O modpack será reinstalado. Os dados do mundo serão preservados.",
    downgrade:
      "ATENÇÃO: Downgrade pode causar problemas de compatibilidade. Faça backup antes!",
    update: "O modpack será atualizado para uma versão mais recente.",
  };

  return (
    <div className="installation-modal-overlay">
      <div className="installation-modal">
        <div className="modal-header">
          <h3>{actionLabels[action]} Modpack</h3>
          <button className="close-btn" onClick={onCancel}>
            ×
          </button>
        </div>

        <div className="modal-content">
          <div className="modpack-summary">
            <img src={modpack.icon} alt={modpack.name} />
            <div>
              <h4>{modpack.name}</h4>
              <p>Versão: {version.name}</p>
              <p>
                Minecraft: {version.minecraftVersion} | {version.loader}{" "}
                {version.loaderVersion}
              </p>
            </div>
          </div>

          <div
            className={`warning-box ${action === "downgrade" ? "danger" : action === "reinstall" ? "info" : "success"}`}
          >
            <p>{actionMessages[action]}</p>
          </div>

          <div className="installation-notes">
            <h5>O que será feito:</h5>
            <ul>
              <li>Download do modpack ({version.size})</li>
              <li>Extração dos arquivos</li>
              <li>Configuração automática do servidor</li>
              {action === "downgrade" && (
                <li className="warning">Remoção de mods incompatíveis</li>
              )}
              {action === "reinstall" && (
                <li>Preservação dos dados do mundo</li>
              )}
            </ul>
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="btn-cancel"
            onClick={onCancel}
            disabled={isProcessing}
          >
            Cancelar
          </button>
          <button
            className={`btn-confirm ${action}`}
            onClick={onConfirm}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <span className="spinner-small"></span>
                Processando...
              </>
            ) : (
              <>
                <span className="btn-icon">
                  {action === "install" && "↓"}
                  {action === "reinstall" && "↻"}
                  {action === "update" && "⬆"}
                  {action === "downgrade" && "⬇"}
                </span>
                {actionLabels[action]}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
