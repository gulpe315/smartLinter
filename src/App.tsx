/**
 * SmartLinter Dashboard App Root
 *
 * Coordinates Header, Responsive Main Layout (QA & TM split),
 * and Fixed Bottom AI Command Bar with Tauri bridge event listeners.
 */

import React, { useEffect } from 'react';
import { Header } from './components/layout/Header.tsx';
import { MainLayout } from './components/layout/MainLayout.tsx';
import { StatusBar } from './components/layout/StatusBar.tsx';
import { useBridgeStore } from './stores/bridgeStore.ts';

export const App: React.FC = () => {
  const initEventListener = useBridgeStore((state) => state.initEventListener);

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
      className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden"
    >
      {/* Top Header & Telemetry Badges */}
      <Header />

      {/* Main Responsive Split QA & TM Viewport */}
      <MainLayout />

      {/* Fixed Bottom AI Command Bar & Status Strip */}
      <StatusBar />
    </div>
  );
};

export default App;
