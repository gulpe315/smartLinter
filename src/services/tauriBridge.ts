/**
 * SmartLinter Bridge Service & Event Subscription Abstraction
 *
 * Provides strongly-typed abstraction layer for communication with
 * Tauri Rust backend and the Local Bridge Server (127.0.0.1:49152).
 */

import {
  type EditorType,
  type ParagraphPayload,
  type ReplacementCommand,
  type ReplacementResult,
  type QaReport,
  type QaIssue,
} from '../../shared/protocol/types.ts';
import {
  type ModelInfo,
  type GuidelineSet,
  type TmEntry,
  evaluateVramWarning,
} from '../types/config.ts';
import {
  parseGuidelineContent,
  parseTmContent,
} from '../utils/parserUtils.ts';

/** Bridge status event payload */
export interface BridgeStatusPayload {
  connected: boolean;
  editorType: EditorType | null;
  sessionId?: string;
  activeDocument?: string;
  version?: string;
}

/** LLM health and connectivity payload */
export interface LlmStatusPayload {
  isAlive: boolean;
  provider: string;
  activeModel?: string;
  latencyMs?: number;
  message?: string;
}

/** TM & Guideline loaded status payload */
export interface TmStatusPayload {
  tmLoaded: boolean;
  entriesCount: number;
  fileName?: string;
  guidelinesLoaded: boolean;
  guidelinesCount: number;
}

/** Batch scan progress event payload */
export interface BatchScanProgressPayload {
  active: boolean;
  current: number;
  total: number;
  percent: number;
  isAborted: boolean;
}

/** QA analysis report event payload */
export interface QaReportPayload {
  paragraphId: string;
  paragraphText: string;
  paragraphHash: string;
  report: QaReport;
}

/** Supported Bridge Event Map */
export interface BridgeEventMap {
  'bridge-status-changed': BridgeStatusPayload;
  'new-paragraph-detected': ParagraphPayload;
  'replacement-result': ReplacementResult;
  'llm-status-changed': LlmStatusPayload;
  'tm-status-changed': TmStatusPayload;
  'batch-scan-progress': BatchScanProgressPayload;
  'qa-report-received': QaReportPayload;
}

export type BridgeEventName = keyof BridgeEventMap;
export type BridgeEventHandler<K extends BridgeEventName> = (payload: BridgeEventMap[K]) => void;

/**
 * Abstract interface for event subscription & backend communication
 */
export interface IBridgeService {
  /** Subscribes to a strongly-typed backend event. Returns an unlisten cleanup function. */
  listen<K extends BridgeEventName>(event: K, handler: BridgeEventHandler<K>): () => void;

  /** Emits an event (useful in mock / testing environments) */
  emit<K extends BridgeEventName>(event: K, payload: BridgeEventMap[K]): void;

  /** Sends a text replacement command to the native editor via bridge */
  sendReplacementCommand(command: ReplacementCommand): Promise<ReplacementResult>;

  /** Fetches current bridge health and status */
  fetchBridgeHealth(): Promise<BridgeStatusPayload>;

  /** Analyzes paragraph text with LLM and returns structured QaReport */
  analyzeParagraph(paragraph: ParagraphPayload): Promise<QaReport>;

  /** Fetches installed Ollama models via GET /api/tags or Tauri backend */
  fetchOllamaModels(host?: string): Promise<ModelInfo[]>;


  /** Sets the active Ollama model */
  setOllamaModel(modelName: string): Promise<boolean>;

  /** Loads and parses guideline file content */
  loadGuidelineContent(content: string, filename?: string): Promise<GuidelineSet>;

  /** Loads and parses TM file content */
  loadTmContent(content: string, filename?: string): Promise<{ count: number; entries: TmEntry[] }>;

  /** Starts a batch scan simulation or triggers backend queue */
  startBatchScan(total?: number): Promise<void>;

  /** Aborts ongoing batch scan */
  abortBatchScan(): Promise<boolean>;

  /** Sets always-on-top window pin state (Pin Mode) */
  setAlwaysOnTop(pinned: boolean): Promise<boolean>;

  /** Disconnects all listeners and cleans up resources */
  destroy(): void;
}

/** Default mock models for testing and development */
export const DEFAULT_MOCK_MODELS: ModelInfo[] = [
  {
    name: 'qwen2.5:7b',
    model: 'qwen2.5:7b',
    modifiedAt: '2026-08-20T10:00:00Z',
    sizeBytes: 4_400_000_000,
    digest: 'sha256:4a5b6c7d',
    parameterSize: '7.6B',
    quantizationLevel: 'Q4_K_M',
    ...evaluateVramWarning(4_400_000_000, '7.6B'),
    details: {
      family: 'qwen2',
      format: 'gguf',
      parameterSize: '7.6B',
      quantizationLevel: 'Q4_K_M',
    },
  },
  {
    name: 'llama3.1:8b',
    model: 'llama3.1:8b',
    modifiedAt: '2026-08-21T12:30:00Z',
    sizeBytes: 4_700_000_000,
    digest: 'sha256:8e9f0a1b',
    parameterSize: '8.0B',
    quantizationLevel: 'Q4_K_M',
    ...evaluateVramWarning(4_700_000_000, '8.0B'),
    details: {
      family: 'llama',
      format: 'gguf',
      parameterSize: '8.0B',
      quantizationLevel: 'Q4_K_M',
    },
  },
  {
    name: 'qwen2.5:14b',
    model: 'qwen2.5:14b',
    modifiedAt: '2026-08-19T08:15:00Z',
    sizeBytes: 9_000_000_000,
    digest: 'sha256:14c15d16',
    parameterSize: '14.7B',
    quantizationLevel: 'Q4_K_M',
    ...evaluateVramWarning(9_000_000_000, '14.7B'),
    details: {
      family: 'qwen2',
      format: 'gguf',
      parameterSize: '14.7B',
      quantizationLevel: 'Q4_K_M',
    },
  },
  {
    name: 'mistral:7b',
    model: 'mistral:7b',
    modifiedAt: '2026-08-18T14:20:00Z',
    sizeBytes: 4_100_000_000,
    digest: 'sha256:7f8g9h0i',
    parameterSize: '7.2B',
    quantizationLevel: 'Q4_0',
    ...evaluateVramWarning(4_100_000_000, '7.2B'),
    details: {
      family: 'mistral',
      format: 'gguf',
      parameterSize: '7.2B',
      quantizationLevel: 'Q4_0',
    },
  },
  {
    name: 'gemma2:9b',
    model: 'gemma2:9b',
    modifiedAt: '2026-08-22T09:00:00Z',
    sizeBytes: 5_400_000_000,
    digest: 'sha256:9a0b1c2d',
    parameterSize: '9.2B',
    quantizationLevel: 'Q4_K_M',
    ...evaluateVramWarning(5_400_000_000, '9.2B'),
    details: {
      family: 'gemma2',
      format: 'gguf',
      parameterSize: '9.2B',
      quantizationLevel: 'Q4_K_M',
    },
  },
];

/**
 * Mock QA Issue Analyzer for testing and development
 */
export function generateMockQaReport(text: string): QaReport {
  const issues: QaIssue[] = [];

  if (text.includes('레플리카 카운트')) {
    issues.push({
      category: '용어 혼용',
      originalSegment: '레플리카 카운트',
      suggestedSegment: '복제본 수',
      reason: '표준 클라우드 용어 지침에 따라 "레플리카 카운트" 대신 "복제본 수"로 표준화합니다.',
      severity: 'HIGH',
    });
  }

  if (text.includes('업데이트되어지게 됩니다')) {
    issues.push({
      category: '번역투',
      originalSegment: '업데이트되어지게 됩니다',
      suggestedSegment: '업데이트됩니다',
      reason: '이중 피동("되어지게") 표현을 지양하고 명확하고 간결한 능동형 문장으로 교정합니다.',
      severity: 'MEDIUM',
    });
  }

  if (text.includes('3 으로')) {
    issues.push({
      category: '맞춤법',
      originalSegment: '3 으로',
      suggestedSegment: '3으로',
      reason: '숫자와 조사 사이에는 공백을 두지 않는 것이 한글 맞춤법 표준입니다.',
      severity: 'LOW',
    });
  }

  if (text.includes('설정 하세요 .')) {
    issues.push({
      category: '맞춤법',
      originalSegment: '설정 하세요 .',
      suggestedSegment: '설정하세요.',
      reason: '마침표 앞의 불필요한 공백을 제거하고 본용언과 보조용언의 붙여쓰기 규칙을 적용합니다.',
      severity: 'LOW',
    });
  }

  if (text.includes('오역 샘플')) {
    issues.push({
      category: '오역',
      originalSegment: '오역 샘플',
      suggestedSegment: '정확한 번역',
      reason: '원문의 의미와 상반되게 번역된 오역을 교정합니다.',
      severity: 'HIGH',
    });
  }

  return {
    status: issues.length > 0 ? 'FAIL' : 'PASS',
    issues,
  };
}

/**
 * In-memory / Mock Bridge Service for browser development and unit testing
 */
export class MockBridgeService implements IBridgeService {
  private listeners: Map<string, Set<(payload: any) => void>> = new Map();
  private alwaysOnTop = false;
  private currentModel = 'qwen2.5:7b';
  private batchInterval: any = null;
  private mockModels: ModelInfo[] = [...DEFAULT_MOCK_MODELS];

  listen<K extends BridgeEventName>(event: K, handler: BridgeEventHandler<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const handlers = this.listeners.get(event)!;
    handlers.add(handler as (payload: any) => void);

    return () => {
      handlers.delete(handler as (payload: any) => void);
    };
  }

  emit<K extends BridgeEventName>(event: K, payload: BridgeEventMap[K]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((h) => {
        try {
          h(payload);
        } catch (err) {
          console.error(`Error executing listener for ${event}:`, err);
        }
      });
    }

    if (event === 'new-paragraph-detected') {
      const paragraph = payload as ParagraphPayload;
      const report = generateMockQaReport(paragraph.text);
      if (report.issues.length > 0) {
        setTimeout(() => {
          this.emit('qa-report-received', {
            paragraphId: paragraph.paragraphId,
            paragraphText: paragraph.text,
            paragraphHash: paragraph.hash,
            report,
          });
        }, 0);
      }
    }
  }

  async analyzeParagraph(paragraph: ParagraphPayload): Promise<QaReport> {
    const report = generateMockQaReport(paragraph.text);
    this.emit('qa-report-received', {
      paragraphId: paragraph.paragraphId,
      paragraphText: paragraph.text,
      paragraphHash: paragraph.hash,
      report,
    });
    return report;
  }

  async sendReplacementCommand(command: ReplacementCommand): Promise<ReplacementResult> {
    const result: ReplacementResult = {
      commandId: command.commandId,
      status: 'SUCCESS',
      currentHash: command.expectedHash,
      message: 'Mock replacement applied successfully',
    };
    this.emit('replacement-result', result);
    return result;
  }

  async fetchBridgeHealth(): Promise<BridgeStatusPayload> {
    return {
      connected: false,
      editorType: null,
      version: '0.1.0-mock',
    };
  }

  async fetchOllamaModels(_host?: string): Promise<ModelInfo[]> {
    return [...this.mockModels];
  }

  async setOllamaModel(modelName: string): Promise<boolean> {
    this.currentModel = modelName;
    this.emit('llm-status-changed', {
      isAlive: true,
      provider: 'ollama',
      activeModel: modelName,
      latencyMs: 42,
      message: 'Model switched successfully',
    });
    return true;
  }

  async loadGuidelineContent(content: string, filename?: string): Promise<GuidelineSet> {
    const set = parseGuidelineContent(content, filename);
    this.emit('tm-status-changed', {
      tmLoaded: false,
      entriesCount: 0,
      guidelinesLoaded: true,
      guidelinesCount: set.rules.length,
    });
    return set;
  }

  async loadTmContent(content: string, filename?: string): Promise<{ count: number; entries: TmEntry[] }> {
    const entries = parseTmContent(content, filename);
    this.emit('tm-status-changed', {
      tmLoaded: entries.length > 0,
      entriesCount: entries.length,
      fileName: filename,
      guidelinesLoaded: true,
      guidelinesCount: 5,
    });
    return { count: entries.length, entries };
  }

  async startBatchScan(total = 20): Promise<void> {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
    }

    let current = 0;
    this.emit('batch-scan-progress', {
      active: true,
      current: 0,
      total,
      percent: 0,
      isAborted: false,
    });

    this.batchInterval = setInterval(() => {
      current += 1;
      const percent = Math.round((current / total) * 100);
      const isDone = current >= total;

      this.emit('batch-scan-progress', {
        active: !isDone,
        current,
        total,
        percent: Math.min(percent, 100),
        isAborted: false,
      });

      if (isDone) {
        clearInterval(this.batchInterval);
        this.batchInterval = null;
      }
    }, 150);
  }

  async abortBatchScan(): Promise<boolean> {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
    }
    this.emit('batch-scan-progress', {
      active: false,
      current: 0,
      total: 0,
      percent: 0,
      isAborted: true,
    });
    return true;
  }

  async setAlwaysOnTop(pinned: boolean): Promise<boolean> {
    this.alwaysOnTop = pinned;
    return this.alwaysOnTop;
  }

  isAlwaysOnTop(): boolean {
    return this.alwaysOnTop;
  }

  destroy(): void {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
    }
    this.listeners.clear();
  }
}

/**
 * Tauri IPC Bridge Service (delegates to window.__TAURI__ when running in Tauri webview)
 */
export class TauriBridgeService implements IBridgeService {
  private fallbackService = new MockBridgeService();
  private unlisteners: Array<() => void> = [];

  private isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
  }

  listen<K extends BridgeEventName>(event: K, handler: BridgeEventHandler<K>): () => void {
    if (!this.isTauriAvailable()) {
      return this.fallbackService.listen(event, handler);
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.event?.listen) {
        let active = true;
        let tauriUnlisten: (() => void) | null = null;

        tauri.event
          .listen(event, (evt: { payload: any }) => {
            if (active) {
              if (event === 'bridge-status-changed' && evt.payload?.state) {
                const state = evt.payload.state;
                const isConnected = state.status === 'CONNECTED';
                const payload: BridgeStatusPayload = {
                  connected: isConnected,
                  editorType: isConnected ? state.editorType : null,
                  sessionId: state.sessionId,
                  activeDocument: state.activeDocument,
                };
                handler(payload as any);
              } else {
                handler(evt.payload);
              }
            }
          })
          .then((unlistenFn: () => void) => {
            if (!active) {
              unlistenFn();
            } else {
              tauriUnlisten = unlistenFn;
            }
          })
          .catch((err: unknown) => {
            console.warn(`Failed to attach Tauri event listener for ${event}:`, err);
          });

        const unlisten = () => {
          active = false;
          if (tauriUnlisten) {
            tauriUnlisten();
          }
        };
        this.unlisteners.push(unlisten);
        return unlisten;
      }
    } catch (e) {
      console.warn('Tauri event listen invocation failed, using fallback:', e);
    }

    return this.fallbackService.listen(event, handler);
  }

  emit<K extends BridgeEventName>(event: K, payload: BridgeEventMap[K]): void {
    if (!this.isTauriAvailable()) {
      this.fallbackService.emit(event, payload);
      return;
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.event?.emit) {
        tauri.event.emit(event, payload);
        return;
      }
    } catch (e) {
      console.warn('Tauri event emit failed:', e);
    }

    this.fallbackService.emit(event, payload);
  }

  async sendReplacementCommand(command: ReplacementCommand): Promise<ReplacementResult> {
    if (!this.isTauriAvailable()) {
      return this.fallbackService.sendReplacementCommand(command);
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('send_replacement_command', { command });
      }
    } catch (e) {
      console.warn('Tauri invoke send_replacement_command failed, using fallback:', e);
    }

    return this.fallbackService.sendReplacementCommand(command);
  }

  async fetchBridgeHealth(): Promise<BridgeStatusPayload> {
    if (!this.isTauriAvailable()) {
      return this.fallbackService.fetchBridgeHealth();
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('get_bridge_status');
      }
    } catch (e) {
      console.warn('Tauri invoke get_bridge_status failed:', e);
    }

    return this.fallbackService.fetchBridgeHealth();
  }

  async analyzeParagraph(paragraph: ParagraphPayload): Promise<QaReport> {
    if (!this.isTauriAvailable()) {
      return this.fallbackService.analyzeParagraph(paragraph);
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('analyze_paragraph', { paragraph });
      }
    } catch (e) {
      console.warn('Tauri invoke analyze_paragraph failed, using fallback:', e);
    }

    return this.fallbackService.analyzeParagraph(paragraph);
  }


  async fetchOllamaModels(host?: string): Promise<ModelInfo[]> {
    if (!this.isTauriAvailable()) {
      // Try direct fetch to Ollama API if in browser / dev mode
      try {
        const ollamaUrl = host || 'http://127.0.0.1:11434';
        const res = await fetch(`${ollamaUrl}/api/tags`);
        if (res.ok) {
          const data = await res.json();
          if (data.models && Array.isArray(data.models)) {
            return data.models.map((m: any) => {
              const param = m.details?.parameter_size;
              const quant = m.details?.quantization_level;
              const size = m.size || 0;
              const { vramWarning, vramWarningReason } = evaluateVramWarning(size, param);
              return {
                name: m.name,
                model: m.model || m.name,
                modifiedAt: m.modified_at,
                sizeBytes: size,
                digest: m.digest,
                parameterSize: param,
                quantizationLevel: quant,
                vramWarning,
                vramWarningReason,
                details: m.details,
              };
            });
          }
        }
      } catch {
        // Fallback to mock models if local ollama is not reachable
      }
      return this.fallbackService.fetchOllamaModels(host);
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('list_ollama_models', { host });
      }
    } catch (e) {
      console.warn('Tauri invoke list_ollama_models failed, using fallback:', e);
    }

    return this.fallbackService.fetchOllamaModels(host);
  }

  async setOllamaModel(modelName: string): Promise<boolean> {
    if (!this.isTauriAvailable()) {
      return this.fallbackService.setOllamaModel(modelName);
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('set_ollama_model', { modelName });
      }
    } catch (e) {
      console.warn('Tauri invoke set_ollama_model failed, using fallback:', e);
    }

    return this.fallbackService.setOllamaModel(modelName);
  }

  async loadGuidelineContent(content: string, filename?: string): Promise<GuidelineSet> {
    if (!this.isTauriAvailable()) {
      return this.fallbackService.loadGuidelineContent(content, filename);
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('load_guideline_content', { content, filename });
      }
    } catch (e) {
      console.warn('Tauri invoke load_guideline_content failed, using fallback:', e);
    }

    return this.fallbackService.loadGuidelineContent(content, filename);
  }

  async loadTmContent(content: string, filename?: string): Promise<{ count: number; entries: TmEntry[] }> {
    if (!this.isTauriAvailable()) {
      return this.fallbackService.loadTmContent(content, filename);
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('load_tm_content', { content, filename });
      }
    } catch (e) {
      console.warn('Tauri invoke load_tm_content failed, using fallback:', e);
    }

    return this.fallbackService.loadTmContent(content, filename);
  }

  async startBatchScan(total?: number): Promise<void> {
    if (!this.isTauriAvailable()) {
      return this.fallbackService.startBatchScan(total);
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        await tauri.core.invoke('start_batch_scan', { total });
        return;
      }
    } catch (e) {
      console.warn('Tauri invoke start_batch_scan failed, using fallback:', e);
    }

    return this.fallbackService.startBatchScan(total);
  }

  async abortBatchScan(): Promise<boolean> {
    if (!this.isTauriAvailable()) {
      return this.fallbackService.abortBatchScan();
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('abort_batch_scan');
      }
    } catch (e) {
      console.warn('Tauri invoke abort_batch_scan failed:', e);
    }

    return this.fallbackService.abortBatchScan();
  }

  async setAlwaysOnTop(pinned: boolean): Promise<boolean> {
    if (!this.isTauriAvailable()) {
      return this.fallbackService.setAlwaysOnTop(pinned);
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('set_always_on_top', { pinned });
      } else if (tauri?.window?.getCurrentWindow) {
        await tauri.window.getCurrentWindow().setAlwaysOnTop(pinned);
        return true;
      }
    } catch (e) {
      console.warn('Tauri invoke set_always_on_top failed, using fallback:', e);
    }

    return this.fallbackService.setAlwaysOnTop(pinned);
  }

  destroy(): void {
    this.unlisteners.forEach((u) => u());
    this.unlisteners = [];
    this.fallbackService.destroy();
  }
}

/** Singleton instance provider */
let defaultBridgeService: IBridgeService | null = null;

export function getBridgeService(): IBridgeService {
  if (!defaultBridgeService) {
    defaultBridgeService = new TauriBridgeService();
  }
  return defaultBridgeService;
}

export function setBridgeService(service: IBridgeService): void {
  if (defaultBridgeService && defaultBridgeService !== service) {
    defaultBridgeService.destroy();
  }
  defaultBridgeService = service;
}
