import React, { useEffect } from 'react';
import { Header } from './components/layout/Header.tsx';
import { ConnectionBanner } from './components/layout/ConnectionBanner.tsx';
import { MainLayout } from './components/layout/MainLayout.tsx';
import { StatusBar } from './components/layout/StatusBar.tsx';
import { QACardList } from './components/qa/QACardList.tsx';
import { TMMatchPanel } from './components/tm/TMMatchPanel.tsx';
import { SettingsModal } from './components/config/SettingsModal.tsx';
import { GuidelineViewer } from './components/config/GuidelineViewer.tsx';
import { useBridgeStore } from './stores/bridgeStore.ts';
import { useConfigStore } from './stores/configStore.ts';
import { persistQaStoreSnapshot, useQaStore } from './stores/qaStore.ts';
import { useTmStore } from './stores/tmStore.ts';
import { getBridgeService } from './services/tauriBridge.ts';

export function isRefreshShortcut(event: KeyboardEvent): boolean {
  return event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r');
}

export const App: React.FC = () => {
  const initEventListener = useBridgeStore((state) => state.initEventListener);
  const initQaListener = useQaStore((state) => state.initEventListener);
  const initTmListener = useTmStore((state) => state.initEventListener);
  const syncSelectedModel = useConfigStore((state) => state.syncSelectedModel);
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
    getBridgeService()
      .fetchBridgeHealth()
      .then((status) => useBridgeStore.getState().setEditorStatus(status))
      .catch(() => {
        // Event listeners remain active and will handle later bridge status changes.
      });
    // Restore the persisted model choice into the queue during application startup.
    void syncSelectedModel();
    return () => {
      cleanupBridge();
      cleanupQa();
      cleanupTm();
    };
  }, [initEventListener, initQaListener, initTmListener, syncSelectedModel]);

  useEffect(() => {
    // Vite development intentionally keeps browser refresh available: persisted
    // cards make it useful for exercising reload recovery. Desktop production
    // treats refresh as an unsupported browser-only operation.
    if (import.meta.env.DEV) return;
    const blockRefresh = (event: KeyboardEvent) => {
      if (isRefreshShortcut(event)) event.preventDefault();
    };
    window.addEventListener('keydown', blockRefresh);
    return () => window.removeEventListener('keydown', blockRefresh);
  }, []);

  useEffect(() => {
    // Persist normally writes synchronously on every store update. This covers
    // only the final renderer-unload edge between a card update and teardown.
    window.addEventListener('beforeunload', persistQaStoreSnapshot);
    return () => window.removeEventListener('beforeunload', persistQaStoreSnapshot);
  }, []);

  return (
    <div
      data-testid="smartlinter-app-root"
      onContextMenu={(event) => {
        if (!import.meta.env.DEV) event.preventDefault();
      }}
      className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden relative"
    >
      {/* Top Header & Telemetry Badges */}
      <Header />

      {/* Reconnecting Alert Banner (Yellow / Amber) */}
      <ConnectionBanner />

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
