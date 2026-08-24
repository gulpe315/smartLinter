/**
 * SmartLinter Dashboard App Root
 *
 * Coordinates Header, Responsive Main Layout (QA & TM split),
 * Fixed Bottom AI Command Bar, and Settings / Guideline Modals with Tauri bridge events.
 */

import React, { useEffect } from 'react';
import { Header } from './components/layout/Header.tsx';
import { MainLayout } from './components/layout/MainLayout.tsx';
import { StatusBar } from './components/layout/StatusBar.tsx';
import { SettingsModal } from './components/config/SettingsModal.tsx';
import { GuidelineViewer } from './components/config/GuidelineViewer.tsx';
import { useBridgeStore } from './stores/bridgeStore.ts';
import { useConfigStore } from './stores/configStore.ts';

export const App: React.FC = () => {
  const initEventListener = useBridgeStore((state) => state.initEventListener);
  const {
    isSettingsModalOpen,
    closeSettingsModal,
    isGuidelineViewerOpen,
    closeGuidelineViewer,
  } = useConfigStore();

  useEffect(() => {
    // Initialize background event listener for Tauri / Local Bridge events
    const cleanup = initEventListener();
    return () => {
      cleanup();
    };
  }, [initEventListener]);

  return (
    <div
      data-testid="smartlinter-app-root"
      className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden relative"
    >
      {/* Top Header & Telemetry Badges */}
      <Header />

      {/* Main Responsive Split QA & TM Viewport */}
      <MainLayout />

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
