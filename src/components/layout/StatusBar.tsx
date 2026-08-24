/**
 * SmartLinter Dashboard StatusBar & Fixed Bottom AI Command Bar
 *
 * Wraps and exposes AICommandBar for bottom AI conversational natural language inputs,
 * In-card live diff presentation, and Action-First instant editor modifications.
 */

import React from 'react';
import { AICommandBar } from '../chat/AICommandBar.tsx';

export const StatusBar: React.FC = () => {
  return <AICommandBar />;
};

