import React, { useState, useEffect } from 'react';

interface InstallProgressModalProps {
  modpackTitle: string;
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
}

export default function InstallProgressModal({
  modpackTitle,
  isOpen,
  onClose,
  serverId,
}: InstallProgressModalProps) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Iniciando instalação...');
  const [isComplete, setIsComplete] = useState(false);
  const [currentMod, setCurrentMod] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setIsErrorMessage] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setProgress(0);
      setStatus('Iniciando instalação...');
      setIsComplete(false);
      setCurrentMod(null);
      setIsError(false);
      return;
    }

    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/client/servers/${serverId}/modpack`);
        if (!response.ok) return;
        const data = await response.json();
        
        if (!isMounted) return;

        const installStatus = data.status;
        const logText = data.install_log || '';
        const logLines = logText.split('\n').filter(Boolean);

        // 1. Trata status de erro
        if (installStatus === 'error') {
          setIsError(true);
          setIsComplete(false);
          setProgress(100);
          setStatus('Ocorreu um erro durante a instalação');
          const errorLine = logLines.reverse().find((l: string) => l.includes('ERRO'));
          setIsErrorMessage(errorLine ? errorLine.replace(/\[.*?\]\s*/, '') : 'Falha desconhecida.');
          clearInterval(interval);
          return;
        }

        // 2. Trata concluído
        if (installStatus === 'installed') {
          setIsComplete(true);
          setProgress(100);
          setStatus('Instalação concluída com sucesso!');
          setCurrentMod(null);
          clearInterval(interval);
          return;
        }

        // 3. Parser de progresso em tempo real
        if (installStatus === 'installing') {
          let currentProgress = 5;
          let currentStatus = 'Iniciando instalação...';
          let detectedMod: string | null = null;

          for (const line of logLines) {
            if (line.includes('Limpando diretório')) {
              currentProgress = 10;
              currentStatus = 'Limpando diretório do servidor...';
            } else if (line.includes('Limpando instalação anterior')) {
              currentProgress = 15;
              currentStatus = 'Removendo resíduos antigos...';
            } else if (line.includes('Baixando modpack...')) {
              currentProgress = 20;
              currentStatus = 'Baixando modpack principal...';
            } else if (line.includes('Download concluído')) {
              currentProgress = 40;
              currentStatus = 'Download do modpack concluído!';
            } else if (line.includes('Extraindo arquivos...')) {
              currentProgress = 45;
              currentStatus = 'Extraindo arquivos do modpack...';
            } else if (line.includes('NeoForge instalado') || line.includes('Instalando NeoForge')) {
              currentProgress = 55;
              currentStatus = 'Instalando NeoForge Loader...';
            } else if (line.includes('Instalando Forge...')) {
              currentProgress = 55;
              currentStatus = 'Instalando Forge Loader...';
            } else if (line.includes('Detectado manifest.json, processando downloads de mods...')) {
              currentProgress = 60;
              currentStatus = 'Analisando manifest.json...';
            } else if (line.includes('Buscando mod') || line.includes('Arquivo salvo:')) {
              currentProgress = 70;
              currentStatus = 'Baixando mods individuais...';
              
              if (line.includes('fileName:')) {
                const match = line.match(/fileName:\s*([^,]+)/);
                if (match) detectedMod = match[1];
              } else if (line.includes('Buscando mod')) {
                const match = line.match(/Buscando mod\s*([^.]+)/);
                if (match) detectedMod = `ID do projeto: ${match[1]}`;
              }
            } else if (line.includes('Configurando loader:')) {
              currentProgress = 85;
              currentStatus = 'Configurando inicializador...';
            } else if (line.includes('EULA aceita')) {
              currentProgress = 90;
              currentStatus = 'Escrevendo Minecraft EULA...';
            } else if (line.includes('Iniciando servidor...')) {
              currentProgress = 95;
              currentStatus = 'Iniciando servidor...';
            }
          }

          if (currentStatus === 'Baixando mods individuais...') {
            const seekingCount = logLines.filter((l: string) => l.includes('Buscando mod')).length;
            const downloadedCount = logLines.filter((l: string) => l.includes('Arquivo salvo:')).length;
            
            if (seekingCount > 0) {
              const ratio = downloadedCount / seekingCount;
              currentProgress = Math.min(85, Math.floor(60 + (ratio * 25)));
              currentStatus = `Baixando mods (${downloadedCount} de ${seekingCount})...`;
            }
          }

          setProgress(currentProgress);
          setStatus(currentStatus);
          if (detectedMod) {
            setCurrentMod(detectedMod);
          }
        }
      } catch (err) {
        console.error('Erro ao monitorar instalação:', err);
      }
    }, 1500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isOpen]);

  const handleGoToConsole = () => {
    window.location.href = `/server/${serverId}`;
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md shadow-xl border border-gray-700">
        <h3 className="text-xl font-bold text-white mb-4">
          Instalando {modpackTitle}
        </h3>

        <div className="mb-4">
          <div className="flex justify-between text-sm text-gray-300 mb-1 font-medium">
            <span>{status}</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
            <div
              className={`h-4 rounded-full transition-all duration-300 ease-out ${
                isError ? 'bg-red-500' : isComplete ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {currentMod && !isComplete && !isError && (
          <div className="mb-4 p-2 bg-gray-900 bg-opacity-50 rounded border border-gray-700 text-xs text-gray-400 font-mono truncate">
            <span className="text-blue-400 font-bold mr-1">Baixando:</span>
            {currentMod}
          </div>
        )}

        {isError && (
          <div className="mb-4 p-3 bg-red-900 bg-opacity-20 border border-red-500 rounded text-sm text-red-300">
            <p className="font-semibold mb-1">Falha na instalação:</p>
            <p className="text-xs font-mono">{errorMessage}</p>
          </div>
        )}

        {isComplete ? (
          <div className="text-center">
            <p className="text-green-400 mb-4 font-semibold">
              Modpack instalado com sucesso!
            </p>
            <button
              onClick={handleGoToConsole}
              className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-6 rounded transition-colors shadow-md"
            >
              Ir para o Servidor
            </button>
          </div>
        ) : isError ? (
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded text-sm transition-colors"
            >
              Fechar
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center text-gray-400 mt-2">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500 mr-2" />
            <span className="text-sm font-medium">Baixando arquivos, por favor aguarde...</span>
          </div>
        )}
      </div>
    </div>
  );
}
