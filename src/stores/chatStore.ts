/**
 * SmartLinter AI Command Chat Store (Zustand)
 *
 * Manages conversational AI natural language command history,
 * In-card live Diff generation via MicroScopingQueue / LocalLlmProvider,
 * and Action-First instant editor replacement bridge synchronization.
 */

import { create } from 'zustand';
import {
  type ParagraphPayload,
  type ReplacementCommand,
  type ReplacementResult,
  type TextHunk,
} from '../../shared/protocol/types.ts';
import {
  extractDiffHunks,
  sortHunksReverse,
} from '../../shared/engine/diff_engine.ts';
import { computeParagraphHash } from '../../shared/engine/hash_util.ts';
import {
  type IBridgeService,
  getBridgeService,
} from '../services/tauriBridge.ts';
import { useBridgeStore } from './bridgeStore.ts';
import {
  type CommandCardData,
  type CommandCardStatus,
  type QuickPromptItem,
} from '../types/chat.ts';

export const DEFAULT_QUICK_PROMPTS: QuickPromptItem[] = [
  {
    id: 'qp-concise',
    label: '더 간결하게',
    prompt: '선택 문단을 더 간결하고 명확한 기술문서 문체로 요약해줘',
    icon: '⚡',
    description: '불필요한 수식어를 제거하고 문장을 간결하게 압축합니다.',
  },
  {
    id: 'qp-active-voice',
    label: '능동태로 변경',
    prompt: '피동형/번역투 문장을 자연스러운 능동형으로 다듬어줘',
    icon: '✍️',
    description: '이중 피동이나 번역투 표현을 자연스러운 능동 문체로 변경합니다.',
  },
  {
    id: 'qp-std-terms',
    label: '기술 용어 표준화',
    prompt: '공식 클라우드 가이드라인에 맞게 기술 용어를 표준화해줘',
    icon: '🏷️',
    description: '클라우드 가이드라인 표준 용어 표기법을 적용합니다.',
  },
  {
    id: 'qp-spelling',
    label: '맞춤법 및 띄어쓰기 교정',
    prompt: '한글 맞춤법과 띄어쓰기 규칙에 맞게 교정해줘',
    icon: '📝',
    description: '표준 국어 맞춤법 및 조사 띄어쓰기 오류를 교정합니다.',
  },
  {
    id: 'qp-loanword',
    label: '외래어 표기법 준수',
    prompt: '외래어 및 기술 전문 용어를 표준 표기법에 맞춰 수정해줘',
    icon: '🌐',
    description: '외래어 표기법 규정에 따라 전문 용어를 교정합니다.',
  },
];

export interface ChatState {
  // --- State ---
  cards: CommandCardData[];
  activeCardId: string | null;
  inputPrompt: string;
  isGenerating: boolean;
  isHistoryOpen: boolean;
  quickPrompts: QuickPromptItem[];

  // --- Actions ---
  setInputPrompt: (prompt: string) => void;
  setIsHistoryOpen: (open: boolean) => void;
  toggleHistory: () => void;
  setActiveCardId: (id: string | null) => void;
  addCard: (card: CommandCardData) => void;
  updateCard: (id: string, updates: Partial<CommandCardData>) => void;
  dismissCard: (cardId: string) => void;
  removeCard: (cardId: string) => void;
  clearCards: () => void;

  /** Submits a natural language command to LLM for a target paragraph */
  submitCommand: (
    instruction: string,
    paragraphOverride?: ParagraphPayload | null,
    service?: IBridgeService
  ) => Promise<string | null>;

  /** Action-First: Immediately applies card diff to native editor via bridge */
  applyCard: (
    cardId: string,
    service?: IBridgeService
  ) => Promise<ReplacementResult | null>;

  /** Retries a failed or dismissed command card */
  retryCard: (
    cardId: string,
    service?: IBridgeService
  ) => Promise<void>;

  /** Resets state to initial values */
  reset: () => void;
}

const initialState = {
  cards: [] as CommandCardData[],
  activeCardId: null as string | null,
  inputPrompt: '',
  isGenerating: false,
  isHistoryOpen: true,
  quickPrompts: DEFAULT_QUICK_PROMPTS,
};

export const useChatStore = create<ChatState>((set, get) => ({
  ...initialState,

  setInputPrompt: (inputPrompt) => set({ inputPrompt }),

  setIsHistoryOpen: (isHistoryOpen) => set({ isHistoryOpen }),

  toggleHistory: () => set((state) => ({ isHistoryOpen: !state.isHistoryOpen })),

  setActiveCardId: (activeCardId) => set({ activeCardId }),

  addCard: (card) =>
    set((state) => ({
      cards: [card, ...state.cards],
      activeCardId: card.id,
      isHistoryOpen: true,
    })),

  updateCard: (id, updates) =>
    set((state) => ({
      cards: state.cards.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),

  dismissCard: (cardId) =>
    set((state) => ({
      cards: state.cards.map((c) =>
        c.id === cardId ? { ...c, status: 'dismissed' as CommandCardStatus } : c
      ),
      activeCardId: state.activeCardId === cardId ? null : state.activeCardId,
    })),

  removeCard: (cardId) =>
    set((state) => ({
      cards: state.cards.filter((c) => c.id !== cardId),
      activeCardId: state.activeCardId === cardId ? null : state.activeCardId,
    })),

  clearCards: () =>
    set({
      cards: [],
      activeCardId: null,
    }),

  submitCommand: async (instruction, paragraphOverride, service) => {
    const trimmedInstruction = instruction.trim();
    if (!trimmedInstruction) return null;

    const bridgeService = service || getBridgeService();
    const bridgeState = useBridgeStore.getState();

    // Determine target paragraph context
    const targetParagraph: ParagraphPayload =
      paragraphOverride ||
      bridgeState.activeParagraph || {
        paragraphId: `para-default-${Date.now()}`,
        text: bridgeState.activeParagraph?.text || '기본 선택 문단 텍스트가 없습니다.',
        hash: computeParagraphHash('기본 선택 문단 텍스트가 없습니다.'),
        source: bridgeState.activeDocument || 'Document.docx',
        timestamp: Date.now(),
        editorType: bridgeState.editorType || 'Word',
      };

    const cardId = `cmd-card-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const newCard: CommandCardData = {
      id: cardId,
      prompt: trimmedInstruction,
      paragraphId: targetParagraph.paragraphId,
      paragraphHash: targetParagraph.hash,
      originalText: targetParagraph.text,
      suggestedText: '',
      diffHunks: [],
      status: 'generating',
      createdAt: Date.now(),
      model: bridgeState.llmModel || 'qwen2.5:7b',
    };

    // Insert new generating card at top
    set((state) => ({
      cards: [newCard, ...state.cards],
      activeCardId: cardId,
      isGenerating: true,
      isHistoryOpen: true,
      inputPrompt: '',
    }));

    // Also update bridge store command input for cross-store telemetry
    bridgeState.setCommandInput(trimmedInstruction);

    try {
      // Execute query via LocalLlmProvider / MicroScopingQueue bridge abstraction
      const startTime = Date.now();
      const res = await bridgeService.executeAiCommand(trimmedInstruction, targetParagraph);
      const durationMs = res.durationMs || Date.now() - startTime;

      const suggestedText = res.suggestedText || targetParagraph.text;
      const hunks = extractDiffHunks(targetParagraph.text, suggestedText);

      set((state) => ({
        cards: state.cards.map((c) =>
          c.id === cardId
            ? {
                ...c,
                suggestedText,
                diffHunks: hunks,
                status: 'ready',
                durationMs,
                model: res.model || c.model,
                errorMessage: undefined,
              }
            : c
        ),
        isGenerating: false,
      }));

      return cardId;
    } catch (err: any) {
      set((state) => ({
        cards: state.cards.map((c) =>
          c.id === cardId
            ? {
                ...c,
                status: 'failed',
                errorMessage: err?.message || 'AI 교정 생성 중 오류가 발생했습니다.',
              }
            : c
        ),
        isGenerating: false,
      }));
      return null;
    }
  },

  applyCard: async (cardId, service) => {
    const card = get().cards.find((c) => c.id === cardId);
    if (!card || card.status === 'applying' || card.status === 'applied') {
      return null;
    }

    const bridgeService = service || getBridgeService();

    // Mark card as applying
    set((state) => ({
      cards: state.cards.map((c) =>
        c.id === cardId ? { ...c, status: 'applying', errorMessage: undefined } : c
      ),
    }));

    try {
      // 1. Calculate diff hunks and reverse order sort
      const originalText = card.originalText;
      const suggestedText = card.suggestedText;

      const hunks =
        card.diffHunks && card.diffHunks.length > 0
          ? card.diffHunks
          : extractDiffHunks(originalText, suggestedText);

      const reverseHunks = sortHunksReverse(hunks);
      const baseHash = card.paragraphHash || computeParagraphHash(originalText);
      const expectedHash = computeParagraphHash(suggestedText);

      const command: ReplacementCommand = {
        commandId: `cmd-chat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        paragraphId: card.paragraphId,
        baseHash,
        expectedHash,
        hunks: reverseHunks,
      };

      // 2. Dispatch to native editor via bridge
      const result = await bridgeService.sendReplacementCommand(command);

      if (result.status === 'SUCCESS') {
        set((state) => ({
          cards: state.cards.map((c) =>
            c.id === cardId
              ? {
                  ...c,
                  status: 'applied',
                  appliedAt: Date.now(),
                  resultHash: result.currentHash,
                  errorMessage: undefined,
                }
              : c
          ),
        }));

        // Update bridge active paragraph if matching
        const bridgeState = useBridgeStore.getState();
        bridgeState.setLastReplacementResult(result);
        if (bridgeState.activeParagraph?.paragraphId === card.paragraphId) {
          bridgeState.setActiveParagraph({
            ...bridgeState.activeParagraph,
            text: suggestedText,
            hash: result.currentHash || expectedHash,
          });
        }
      } else if (result.status === 'STALE_REJECTED') {
        set((state) => ({
          cards: state.cards.map((c) =>
            c.id === cardId
              ? {
                  ...c,
                  status: 'stale_rejected',
                  errorMessage:
                    result.message ||
                    '에디터의 문서가 방금 수정되어 해시가 일치하지 않습니다. 최신 상태를 확인해 주세요.',
                }
              : c
          ),
        }));
      } else {
        set((state) => ({
          cards: state.cards.map((c) =>
            c.id === cardId
              ? {
                  ...c,
                  status: 'failed',
                  errorMessage: result.message || `치환 실패 (${result.status})`,
                }
              : c
          ),
        }));
      }

      return result;
    } catch (err: any) {
      set((state) => ({
        cards: state.cards.map((c) =>
          c.id === cardId
            ? {
                ...c,
                status: 'failed',
                errorMessage: err?.message || '치환 명령 전송 중 예외가 발생했습니다.',
              }
            : c
        ),
      }));
      return null;
    }
  },

  retryCard: async (cardId, service) => {
    const card = get().cards.find((c) => c.id === cardId);
    if (!card) return;

    const mockPara: ParagraphPayload = {
      paragraphId: card.paragraphId,
      text: card.originalText,
      hash: card.paragraphHash,
      source: '',
      timestamp: Date.now(),
      editorType: 'Word',
    };

    get().removeCard(cardId);
    await get().submitCommand(card.prompt, mockPara, service);
  },

  reset: () => set({ ...initialState }),
}));
