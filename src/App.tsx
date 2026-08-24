import React, { useEffect } from 'react';
import { Header } from './components/layout/Header.tsx';
import { MainLayout } from './components/layout/MainLayout.tsx';
import { StatusBar } from './components/layout/StatusBar.tsx';
import { QACardList } from './components/qa/QACardList.tsx';
import { TMMatchPanel } from './components/tm/TMMatchPanel.tsx';
import { SettingsModal } from './components/config/SettingsModal.tsx';
import { GuidelineViewer } from './components/config/GuidelineViewer.tsx';
import { useBridgeStore } from './stores/bridgeStore.ts';
import { useConfigStore } from './stores/configStore.ts';
import { useQaStore } from './stores/qaStore.ts';
import { useTmStore } from './stores/tmStore.ts';

export const App: React.FC = () => {
  const initEventListener = useBridgeStore((state) => state.initEventListener);
  const initQaListener = useQaStore((state) => state.initEventListener);
  const initTmListener = useTmStore((state) => state.initEventListener);
  const {
    isSettingsModalOpen,
    closeSettingsModal,
    isGuidelineViewerOpen,
    closeGuidelineViewer,
  } = useConfigStore();

  useEffect(() => {
    // Initialize background event listeners for Tauri / Local Bridge events
    const cleanupBridge = initEventListener();
    const cleanupQa = initQaListener();
    const cleanupTm = initTmListener();
    return () => {
      cleanupBridge();
      cleanupQa();
      cleanupTm();
    };
  }, [initEventListener, initQaListener, initTmListener]);

  return (
    <div
      data-testid="smartlinter-app-root"
      className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden relative"
    >
      {/* Top Header & Telemetry Badges */}
      <Header />

      {/* Main Responsive Split QA & TM Viewport with real-time QA Card List and TM Match Panel */}
      <MainLayout qaSlot={<QACardList />} tmSlot={<TMMatchPanel />} />

      {/* Fixed Bottom AI Command Bar & Status Strip */}
      <StatusBar />

      {/* Global Modals */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={closeSettingsModal}
      />

      <GuidelineViewer
        isOpen={isGuidelineViewerOpen}
        asModal={true}
        onClose={closeGuidelineViewer}
      />
    </div>
  );
};

export default App;

