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
  const [stepTitle, setStepTitle] = useState('Preparando instalação');
  const [stepDescription, setStepDescription] = useState('Resolvendo a lista de arquivos...');
  const [isComplete, setIsComplete] = useState(false);
  const [currentMod, setCurrentMod] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setIsErrorMessage] = useState('');
  const [totalModsInstalled, setTotalModsInstalled] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setProgress(0);
      setStepTitle('Preparando instalação');
      setStepDescription('Resolvendo a lista de arquivos...');
      setIsComplete(false);
      setCurrentMod(null);
      setIsError(false);
      setTotalModsInstalled(null);
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

        const downloadedCount = logLines.filter((l: string) => l.includes('Arquivo salvo:')).length;
        if (downloadedCount > 0) {
          setTotalModsInstalled(downloadedCount);
        }

        // 1. Trata status de erro
        if (installStatus === 'error') {
          setIsError(true);
          setIsComplete(false);
          setProgress(100);
          setStepTitle('Ocorreu um erro');
          setStepDescription('A instalação foi interrompida devido a um erro.');
          const errorLine = logLines.reverse().find((l: string) => l.includes('ERRO'));
          setIsErrorMessage(errorLine ? errorLine.replace(/\[.*?\]\s*/, '') : 'Falha desconhecida durante a execução.');
          clearInterval(interval);
          return;
        }

        // 2. Trata concluído
        if (installStatus === 'installed') {
          clearInterval(interval);
          
          // Se o progresso já estiver completo ou quase completo, finaliza direto
          if (progress >= 95) {
            setProgress(100);
            setIsComplete(true);
            setStepTitle('Instalação concluída');
            setStepDescription('O modpack foi instalado com sucesso no seu servidor!');
            setCurrentMod(null);
            return;
          }

          // Caso contrário, faz uma varredura acelerada (fast-forward) super satisfatória de etapas
          let tempProgress = progress > 5 ? progress : 15;
          const ffInterval = setInterval(() => {
            tempProgress += Math.floor(Math.random() * 4) + 6; // incrementa entre 6% e 9% por tick
            if (tempProgress >= 100) {
              tempProgress = 100;
              clearInterval(ffInterval);
              setIsComplete(true);
              setStepTitle('Instalação concluída');
              setStepDescription('O modpack foi instalado com sucesso no seu servidor!');
              setCurrentMod(null);
            } else {
              // Atualiza o título e descrição das etapas dinamicamente durante a varredura rápida
              if (tempProgress < 25) {
                setStepTitle('Preparando instalação');
                setStepDescription('Limpando diretório do servidor e preparando arquivos...');
              } else if (tempProgress < 40) {
                setStepTitle('Verificando modloader');
                setStepDescription('Instalando e configurando o loader (Forge/Fabric/NeoForge)...');
              } else if (tempProgress < 60) {
                setStepTitle('Baixando arquivos');
                setStepDescription('Baixando arquivo zip principal do modpack e manifest.json...');
              } else if (tempProgress < 85) {
                setStepTitle('Baixando mods');
                setStepDescription('Baixando mods individuais de forma paralela...');
              } else {
                setStepTitle('Configurando');
                setStepDescription('Ajustando configurações do servidor e limpando arquivos desnecessários...');
              }
            }
            setProgress(tempProgress);
          }, 80); // Roda a cada 80ms para um efeito super fluido e satisfatório!
          
          return;
        }

        // 3. Parser de progresso em tempo real
        if (installStatus === 'installing') {
          let currentProgress = 5;
          let currentStepTitle = 'Preparando instalação';
          let currentStepDesc = 'Iniciando o instalador e resolvendo a lista de arquivos...';
          let detectedMod: string | null = null;

          for (const line of logLines) {
            // Stage 1: Preparing & Clearing
            if (line.includes('Limpando diretório') || line.includes('Limpando instalação anterior')) {
              currentProgress = 10;
              currentStepTitle = 'Preparando instalação';
              currentStepDesc = 'Limpando diretório do servidor e preparando novos arquivos...';
            } 
            // Stage 2: Checking/Installing Modloader
            else if (line.includes('Executando instalador') || line.includes('Instalando NeoForge') || line.includes('Instalando Forge') || line.includes('Fabric detectado')) {
              currentProgress = 25;
              currentStepTitle = 'Verificando modloader';
              currentStepDesc = 'Instalando e configurando o loader (Forge/Fabric/NeoForge)...';
            } 
            // Stage 3: Downloading ZIP & Manifest
            else if (line.includes('Baixando modpack...')) {
              currentProgress = 40;
              currentStepTitle = 'Baixando arquivos';
              currentStepDesc = 'Baixando arquivo zip principal do modpack e manifest.json...';
            } else if (line.includes('Download concluído') || line.includes('Extraindo arquivos')) {
              currentProgress = 50;
              currentStepTitle = 'Baixando arquivos';
              currentStepDesc = 'Extraindo arquivos do pacote ZIP do modpack...';
            } 
            // Stage 4: Processing manifest & Downloading mods
            else if (line.includes('Detectado manifest.json, processando downloads de mods...')) {
              currentProgress = 60;
              currentStepTitle = 'Baixando mods';
              currentStepDesc = 'Analisando manifest.json e preparando fila de download...';
            } else if (line.includes('Buscando mod') || line.includes('Arquivo salvo:') || line.includes('[CurseForge]') || line.includes('[Modrinth]')) {
              currentProgress = 70;
              currentStepTitle = 'Baixando mods';
              currentStepDesc = 'Baixando mods individuais de forma paralela...';
              
              if (line.includes('fileName:')) {
                const match = line.match(/fileName:\s*([^,]+)/);
                if (match) detectedMod = match[1];
              } else if (line.includes('Buscando mod')) {
                const match = line.match(/Buscando mod\s*([^.]+)/);
                if (match) detectedMod = `ID do projeto: ${match[1]}`;
              } else if (line.includes('IGNORADO (Client-Side):')) {
                const match = line.match(/IGNORADO \(Client-Side\):\s*(.+)$/);
                if (match) detectedMod = `Ignorado (Client): ${match[1]}`;
              }
            } 
            // Stage 5: Configuring
            else if (line.includes('Configurando loader:') || line.includes('EULA aceita') || line.includes('Removendo arquivos de cliente') || line.includes('[ClientSide] Removido:')) {
              currentProgress = 85;
              currentStepTitle = 'Configurando';
              currentStepDesc = 'Ajustando configurações do servidor e limpando arquivos desnecessários...';
            } 
            // Stage 6: Finishing
            else if (line.includes('Iniciando servidor...') || line.includes('Servidor pronto') || line.includes('Instalação concluída')) {
              currentProgress = 95;
              currentStepTitle = 'Terminando';
              currentStepDesc = 'Finalizando processos e marcando instalação como concluída...';
            }
          }

          // If individual mods download is active, calculate precise percentage and subtitle
          if (currentStepTitle === 'Baixando mods') {
            const seekingCount = logLines.filter((l: string) => l.includes('Buscando mod') || l.includes('Verificando mod')).length;
            const downloadedCount = logLines.filter((l: string) => l.includes('Arquivo salvo:') || l.includes('IGNORADO (Client-Side):')).length;
            
            if (seekingCount > 0) {
              const ratio = downloadedCount / seekingCount;
              currentProgress = Math.min(85, Math.floor(60 + (ratio * 25)));
              currentStepDesc = `Baixando mods (${downloadedCount} de ${seekingCount} concluídos)...`;
            }
          }

          setProgress(currentProgress);
          setStepTitle(currentStepTitle);
          setStepDescription(currentStepDesc);
          if (detectedMod) {
            setCurrentMod(detectedMod);
          }
        }
      } catch (err) {
        console.error('Erro ao monitorar instalação:', err);
      }
    }, 500);

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
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-xl shadow-2xl border border-gray-700">
        <h3 className="text-xl font-semibold text-white mb-1">
          Instalando {modpackTitle}
        </h3>
        <p className="text-xs text-gray-400 mb-6">
          Os arquivos do modpack e suas dependências estão sendo preparados e instalados no seu servidor.
        </p>

        <div className="mb-6">
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-md font-bold text-white tracking-wide">{stepTitle}</span>
            <span className="text-sm font-semibold text-blue-400">{progress}%</span>
          </div>
          <p className="text-xs text-gray-400 mb-3">{stepDescription}</p>
          
          <div className="w-full bg-gray-950 rounded h-3 overflow-hidden shadow-inner p-[1px] border border-gray-700/50">
            <div
              className={`h-full rounded-sm transition-all duration-500 ease-out ${
                isError ? 'bg-red-500' : isComplete ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {currentMod && !isComplete && !isError && (
          <div className="mb-6">
            <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-1">Status detalhado</p>
            <div className="p-3 bg-gray-950/80 rounded border border-gray-700 text-xs text-blue-400 font-mono truncate shadow-sm flex items-center">
              <span className="animate-pulse h-2 w-2 rounded-full bg-blue-500 mr-2 shrink-0"></span>
              <span className="text-gray-400 mr-1">Baixando:</span> {currentMod}
            </div>
          </div>
        )}

        {isError && (
          <div className="mb-6 p-4 bg-red-900/10 border border-red-500/50 rounded-lg text-sm text-red-300">
            <p className="font-semibold mb-1 flex items-center">
              <span className="text-red-500 mr-2">⚠️</span> Falha na instalação:
            </p>
            <p className="text-xs font-mono bg-red-950/30 p-2 rounded border border-red-500/10 whitespace-pre-wrap">{errorMessage}</p>
          </div>
        )}

        {isComplete && (
          <div className="mb-6 p-4 bg-green-900/10 border border-green-500/50 rounded-lg text-sm text-green-300 flex flex-col gap-1 shadow-sm">
            <p className="font-bold flex items-center text-md text-white mb-1">
              <span className="text-green-500 mr-2">✓</span> Instalação Concluída!
            </p>
            <p className="text-xs text-gray-300">
              O modpack foi totalmente instalado e configurado no seu servidor Jexactyl.
            </p>
            {totalModsInstalled !== null && (
              <p className="text-xs font-semibold text-green-400 mt-2 bg-green-950/30 p-2 rounded border border-green-500/10 inline-block w-fit">
                📦 Total de {totalModsInstalled} mods instalados com sucesso.
              </p>
            )}
          </div>
        )}

        {/* Box explicativa 'O que está acontecendo' estilo foto 2 */}
        <div className="mt-4 p-4 bg-gray-900/60 rounded-lg border border-gray-700/50 text-sm">
          <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">O que está acontecendo</h4>
          <ul className="list-none space-y-1.5 text-xs text-gray-400">
            <li className="flex items-start">
              <span className="text-blue-500 mr-1.5">•</span>
              <span><strong>Verificando modloader:</strong> O instalador identifica se é Forge, Fabric ou NeoForge e injeta o inicializador correto.</span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-500 mr-1.5">•</span>
              <span><strong>Baixando serverpack/zip:</strong> Se houver um server pack oficial, ele é baixado e extraído diretamente no servidor.</span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-500 mr-1.5">•</span>
              <span><strong>Baixando mods individuais:</strong> Se for baseado em <code>manifest.json</code>, os mods são baixados em paralelo de forma otimizada.</span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-500 mr-1.5">•</span>
              <span><strong>Configurando e limpando:</strong> Aceita a EULA, limpa mods de cliente inúteis e otimiza as configurações finais.</span>
            </li>
          </ul>
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-gray-700/50 pt-4">
          {isComplete ? (
            <button
              onClick={handleGoToConsole}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded text-sm transition-colors shadow-md"
            >
              Ir para o Console
            </button>
          ) : isError ? (
            <button
              onClick={onClose}
              className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-6 rounded text-sm transition-colors"
            >
              Fechar
            </button>
          ) : (
            <div className="flex items-center text-gray-400">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2" />
              <span className="text-xs font-medium">Baixando arquivos, por favor aguarde...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
