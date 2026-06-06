import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';

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
  const history = useHistory();

  useEffect(() => {
    if (!isOpen) {
      setProgress(0);
      setStatus('Iniciando instalação...');
      setIsComplete(false);
      return;
    }

    // Simula progresso da instalação
    const steps = [
      { at: 10, status: 'Baixando modpack...' },
      { at: 30, status: 'Extraindo arquivos...' },
      { at: 50, status: 'Baixando mods...' },
      { at: 70, status: 'Configurando servidor...' },
      { at: 90, status: 'Finalizando instalação...' },
      { at: 100, status: 'Instalação concluída!' },
    ];

    let currentStep = 0;
    const interval = setInterval(() => {
      if (currentStep < steps.length) {
        setProgress(steps[currentStep].at);
        setStatus(steps[currentStep].status);
        currentStep++;
      } else {
        setIsComplete(true);
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isOpen]);

  const handleGoToConsole = () => {
    history.push(`/server/${serverId}/console`);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md shadow-xl">
        <h3 className="text-xl font-bold text-white mb-4">
          Instalando {modpackTitle}
        </h3>

        <div className="mb-4">
          <div className="flex justify-between text-sm text-gray-400 mb-1">
            <span>{status}</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-4">
            <div
              className="bg-blue-500 h-4 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {isComplete ? (
          <div className="text-center">
            <p className="text-green-400 mb-4">
              Modpack instalado com sucesso!
            </p>
            <button
              onClick={handleGoToConsole}
              className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-6 rounded transition-colors"
            >
              Ir para Console
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center text-gray-400">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500 mr-2" />
            <span>Aguarde...</span>
          </div>
        )}
      </div>
    </div>
  );
}
