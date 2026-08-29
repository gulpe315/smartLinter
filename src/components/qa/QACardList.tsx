/**
 * SmartLinter QA Card List Component
 *
 * Renders the real-time stream of detected QA issue cards with
 * category/severity filtering, smooth animated card insertion,
 * batch actions, and paragraph telemetry status.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  Filter,
  Search,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { useQaStore } from '../../stores/qaStore.ts';
import { useBridgeStore } from '../../stores/bridgeStore.ts';
import { type QACardData, type QASeverityFilter } from '../../types/qa.ts';
import { QACardItem } from './QACardItem.tsx';
import { splitIntoSentences } from '../../utils/sentenceBoundary.ts';

export interface QACardListProps {
  className?: string;
}

type SentenceCardGroup = { paragraphId: string; segmentIndex: number; excerpt: string; cards: QACardData[] };
type ActiveCardGroup = SentenceCardGroup | { card: QACardData };

const groupActiveCards = (cards: QACardData[]): ActiveCardGroup[] => {
  const groups: ActiveCardGroup[] = [];
  const groupsBySentence = new Map<string, SentenceCardGroup>();
  for (const card of cards) {
    if (card.segmentIndex === undefined) { groups.push({ card }); continue; }
    const key = `${card.paragraphId}\u0000${card.segmentIndex}`;
    const existingGroup = groupsBySentence.get(key);
    if (existingGroup) {
      existingGroup.cards.push(card);
      continue;
    }
    const text = splitIntoSentences(card.paragraphText)[card.segmentIndex]?.text ?? '';
    const group = { paragraphId: card.paragraphId, segmentIndex: card.segmentIndex, excerpt: text.length > 120 ? `${text.slice(0, 117)}...` : text, cards: [card] };
    groupsBySentence.set(key, group);
    groups.push(group);
  }
  return groups;
};

export const QACardList: React.FC<QACardListProps> = ({ className = '' }) => {
  const {
    filter,
    setSeverityFilter,
    setSearchQuery,
    dismissCard,
    markCardObsolete,
    acceptCard,
    acceptMatchingCards,
    acceptSentenceGroup,
    dismissAll,
    getFilteredCards,
    getCardCountBySeverity,
    isAnalyzing,
    analysisError,
    appliedCards,
    dismissedCards,
    cards,
    lastEditorDisconnectAt,
    validateLiveCards,
  } = useQaStore();

  const [view, setView] = useState<'active' | 'history'>('active');
  const [locateFailureNotice, setLocateFailureNotice] = useState<string | null>(null);
  const [lastLocatedCardId, setLastLocatedCardId] = useState<string | null>(null);
  const [applyingSentenceGroups, setApplyingSentenceGroups] = useState<Set<string>>(() => new Set());
  const [sentenceGroupErrors, setSentenceGroupErrors] = useState<Map<string, string>>(() => new Map());
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const liveValidationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { activeParagraph, editorConnected, editorType } = useBridgeStore();

  const filteredCards = getFilteredCards();
  const activeCardGroups = useMemo(() => groupActiveCards(filteredCards), [filteredCards]);
  const eligibleSentenceCardIds = useMemo(() => new Set(
    cards.filter((card) => card.status === 'pending'
      && card.validationState !== 'restoring'
      && card.isStale !== true
      && card.isLocked !== true
      && card.segmentIndex !== undefined).map((card) => card.id),
  ), [cards]);

  const applySentenceGroup = async (paragraphId: string, segmentIndex: number) => {
    const key = `${paragraphId}-${segmentIndex}`;
    setApplyingSentenceGroups((current) => new Set(current).add(key));
    setSentenceGroupErrors((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    const result = await acceptSentenceGroup(paragraphId, segmentIndex);
    if (!result || result.status !== 'SUCCESS') {
      const message = useQaStore.getState().cards
        .find((card) => card.paragraphId === paragraphId && card.segmentIndex === segmentIndex)?.errorMessage
        || result?.message || '문장 전체 적용에 실패했습니다.';
      setSentenceGroupErrors((current) => new Map(current).set(key, message));
    }
    setApplyingSentenceGroups((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };
  const focusedCardIds = useMemo(
    () => new Set(
      filteredCards
        .filter((card) => card.paragraphId === activeParagraph?.paragraphId)
        .map((card) => card.id)
    ),
    [filteredCards, activeParagraph?.paragraphId]
  );

  useEffect(() => {
    if (!activeParagraph || focusedCardIds.size === 0) return;

    const focusedCardId = lastLocatedCardId && focusedCardIds.has(lastLocatedCardId)
      ? lastLocatedCardId
      : filteredCards.find((card) => focusedCardIds.has(card.id))?.id;
    cardRefs.current.get(focusedCardId ?? '')?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [activeParagraph?.paragraphId, lastLocatedCardId]);

  useEffect(() => {
    if (lastLocatedCardId && !cards.some((card) => card.id === lastLocatedCardId)) {
      setLastLocatedCardId(null);
    }
  }, [cards, lastLocatedCardId]);
  const counts = getCardCountBySeverity();
  const historyCards = useMemo(
    () => [...appliedCards, ...dismissedCards].sort((a, b) => b.createdAt - a.createdAt),
    [appliedCards, dismissedCards]
  );
  const historyCount = historyCards.length;

  const severityFilters: Array<{ label: string; value: QASeverityFilter; count: number }> = [
    { label: '전체', value: 'ALL', count: counts.total },
    { label: 'High (Error)', value: 'HIGH', count: counts.high },
    { label: 'Medium (Warning)', value: 'MEDIUM', count: counts.medium },
    { label: 'Low (Info)', value: 'LOW', count: counts.low + counts.info },
  ];

  useEffect(() => () => {
    if (liveValidationTimer.current) clearTimeout(liveValidationTimer.current);
  }, []);

  const handleCardListScroll = () => {
    if (liveValidationTimer.current) clearTimeout(liveValidationTimer.current);
    liveValidationTimer.current = setTimeout(() => {
      liveValidationTimer.current = null;
      void validateLiveCards();
    }, 250);
  };

  return (
    <div
      data-testid="qa-card-list-container"
      className={`flex-1 h-full flex flex-col overflow-hidden bg-slate-950/60 ${className}`}
    >
      {/* Top Header & Filters Bar */}
      <div className="flex-none px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        {/* Title & Count Badge */}
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
            QA 위반 사항 검수
          </h2>
          <span
            data-testid="qa-issue-counter"
            className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-semibold"
          >
            {view === 'history' ? historyCount : counts.total}건 발견
          </span>
          {isAnalyzing && (
            <span
              data-testid="qa-analyzing-indicator"
              className="flex items-center gap-1 text-[10px] text-indigo-300 bg-indigo-950/80 px-2 py-0.5 rounded-full border border-indigo-800/80 animate-pulse font-medium"
            >
              <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
              LLM 분석 중...
            </span>
          )}
          {analysisError && (
            <div
              data-testid="qa-analysis-error-banner"
              className="p-2.5 rounded bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <span>{analysisError}</span>
            </div>
          )}
          {!editorConnected && lastEditorDisconnectAt && (
            <span data-testid="qa-editor-offline-status" className="text-[10px] text-slate-300 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700">
              InDesign 연결 끊김 · 마지막 확인: {new Date(lastEditorDisconnectAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Filter Pills & Actions */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg bg-slate-800/80 p-0.5 border border-slate-700/80 text-[11px] text-slate-400">
            <button type="button" data-testid="view-toggle-active" onClick={() => setView('active')} className={`px-2.5 py-1 rounded-md transition-all font-medium ${view === 'active' ? 'bg-indigo-600 text-white shadow-sm font-semibold' : 'hover:text-slate-200 text-slate-400'}`}>진행 중</button>
            <button type="button" data-testid="view-toggle-history" onClick={() => setView('history')} className={`px-2.5 py-1 rounded-md transition-all font-medium flex items-center gap-1 ${view === 'history' ? 'bg-indigo-600 text-white shadow-sm font-semibold' : 'hover:text-slate-200 text-slate-400'}`}>
              기록
              <span className={`text-[9px] px-1 py-0.2 rounded-full ${view === 'history' ? 'bg-indigo-700/80 text-white' : 'bg-slate-700 text-slate-300'}`}>{historyCount}</span>
            </button>
          </div>
          {/* Severity Filter Buttons */}
          {view === 'active' && <div
            data-testid="severity-filter-group"
            className="flex items-center rounded-lg bg-slate-800/80 p-0.5 border border-slate-700/80 text-[11px] text-slate-400"
          >
            {severityFilters.map((sf) => {
              const isActive = filter.severity === sf.value;
              return (
                <button
                  key={sf.value}
                  type="button"
                  data-testid={`filter-${sf.value.toLowerCase()}`}
                  onClick={() => setSeverityFilter(sf.value)}
                  className={`px-2.5 py-1 rounded-md transition-all font-medium flex items-center gap-1 ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                      : 'hover:text-slate-200 text-slate-400'
                  }`}
                >
                  <span>{sf.label}</span>
                  {sf.count > 0 && (
                    <span
                      className={`text-[9px] px-1 py-0.2 rounded-full ${
                        isActive
                          ? 'bg-indigo-700/80 text-white'
                          : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {sf.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>}

          {/* Dismiss All Action (visible when cards exist) */}
          {view === 'active' && counts.total > 0 && (
            <button
              type="button"
              data-testid="dismiss-all-btn"
              onClick={dismissAll}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-400 hover:text-rose-300 hover:bg-rose-950/30 border border-slate-700/80 hover:border-rose-900/60 transition-colors flex items-center gap-1"
              title="현재 발견된 모든 QA 카드 무시/보관"
            >
              <Trash2 className="w-3 h-3" />
              <span>모두 무시</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Scrollable Card List Body */}
      <div
        data-testid="qa-cards-scroll-area"
        onScroll={handleCardListScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3.5"
      >
        {locateFailureNotice && (
          <div
            data-testid="qa-locate-failure-notice"
            role="alert"
            className="p-3 rounded-lg border border-amber-800/70 bg-amber-950/30 text-xs text-amber-200"
          >
            {locateFailureNotice}
          </div>
        )}

        {/* Active Paragraph Telemetry Context Banner */}
        {view === 'active' && activeParagraph && (
          <div
            data-testid="active-paragraph-banner"
            className="p-3 rounded-lg bg-slate-900/80 border border-indigo-900/40 text-xs text-slate-300 shadow-sm"
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                  {activeParagraph.editorType} 문단 감지
                </span>
                <span className="text-[11px] font-mono text-slate-400 break-all">
                  ID: {activeParagraph.paragraphId}
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-500">
                {new Date(activeParagraph.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <p className="font-mono text-slate-200 text-xs bg-slate-950/80 p-2 rounded border border-slate-800/80 leading-relaxed break-words">
              {activeParagraph.text}
            </p>
          </div>
        )}

        {/* Render Cards or Clean/Empty State */}
        {view === 'history' ? (
          historyCards.length > 0 ? (
            <div className="space-y-3">
              {historyCards.map((card) => (
                <div key={card.id} className="animate-in fade-in slide-in-from-top-2 duration-300 fill-mode-forwards">
                  <QACardItem card={card} readOnly />
                </div>
              ))}
            </div>
          ) : (
            <div data-testid="qa-history-empty-state" className="h-64 flex items-center justify-center text-center p-8 border border-dashed border-slate-800/80 rounded-xl bg-slate-900/20 text-sm text-slate-400">
              아직 처리된 카드가 없습니다.
            </div>
          )
        ) : filteredCards.length > 0 ? (
          <div className="space-y-3">
            {activeCardGroups.map((group) => 'cards' in group ? (
              <section key={`${group.paragraphId}-${group.segmentIndex}-${group.cards[0].id}`} className="space-y-2">
                <div data-testid={`qa-sentence-group-${group.paragraphId}-${group.segmentIndex}`} className="px-2 py-1 border-l-2 border-indigo-700/70 text-[10px] text-slate-400 bg-slate-900/50 rounded-r">
                  {(() => {
                    const groupKey = `${group.paragraphId}-${group.segmentIndex}`;
                    const allEligibleIds = new Set(cards.filter((card) => card.paragraphId === group.paragraphId && card.segmentIndex === group.segmentIndex && eligibleSentenceCardIds.has(card.id)).map((card) => card.id));
                    if (allEligibleIds.size < 2) return null;
                    const visibleEligibleIds = group.cards.filter((card) => eligibleSentenceCardIds.has(card.id));
                    const isFilterComplete = visibleEligibleIds.length === allEligibleIds.size;
                    const isApplying = applyingSentenceGroups.has(groupKey) || group.cards.some((card) => card.status === 'applying');
                    return <button
                      type="button"
                      data-testid={`qa-accept-sentence-group-btn-${group.paragraphId}-${group.segmentIndex}`}
                      disabled={!isFilterComplete || isApplying}
                      title={!isFilterComplete ? '필터를 해제하면 문장 전체 적용을 사용할 수 있습니다.' : undefined}
                      onClick={() => void applySentenceGroup(group.paragraphId, group.segmentIndex)}
                      className="mr-2 px-2 py-0.5 rounded border border-indigo-700/70 text-indigo-200 hover:bg-indigo-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >{isApplying ? '적용 중…' : `문장 전체 적용 (${allEligibleIds.size}건)`}</button>;
                  })()}
                  <span className="font-semibold text-indigo-300">문장 {group.segmentIndex + 1}</span>{group.excerpt && <span className="ml-1.5 font-mono">{group.excerpt}</span>}
                </div>
                {sentenceGroupErrors.get(`${group.paragraphId}-${group.segmentIndex}`) && <div role="alert" className="px-2 text-[10px] text-rose-300">{sentenceGroupErrors.get(`${group.paragraphId}-${group.segmentIndex}`)}</div>}
                <div className="space-y-3">{group.cards.map((card) => (
                  <div key={card.id} ref={(element) => { if (element) cardRefs.current.set(card.id, element); else cardRefs.current.delete(card.id); }} className="animate-in fade-in slide-in-from-top-2 duration-300 fill-mode-forwards">
                    <QACardItem card={card} isFocused={focusedCardIds.has(card.id)} onAccept={(id) => acceptCard(id, undefined, { autoResolveStale: true })} onAcceptMatching={(id) => acceptMatchingCards(id)} onDismiss={(id) => dismissCard(id)} onMarkObsolete={(id) => markCardObsolete(id)} onLocateFailure={setLocateFailureNotice} onLocateStart={() => setLastLocatedCardId(card.id)} />
                  </div>
                ))}</div>
              </section>
            ) : (() => { const card = group.card; return (
              <div
                key={card.id}
                ref={(element) => {
                  if (element) cardRefs.current.set(card.id, element);
                  else cardRefs.current.delete(card.id);
                }}
                className="animate-in fade-in slide-in-from-top-2 duration-300 fill-mode-forwards"
              >
                <QACardItem
                  card={card}
                  isFocused={focusedCardIds.has(card.id)}
                  onAccept={(id) => acceptCard(id, undefined, { autoResolveStale: true })}
                  onAcceptMatching={(id) => acceptMatchingCards(id)}
                  onDismiss={(id) => dismissCard(id)}
                  onMarkObsolete={(id) => markCardObsolete(id)}
                  onLocateFailure={setLocateFailureNotice}
                  onLocateStart={() => setLastLocatedCardId(card.id)}
                />
              </div>
            ); })())}
          </div>
        ) : (
          /* Empty / Clean State Guide */
          <div
            data-testid="qa-empty-state"
            className="h-64 flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-800/80 rounded-xl bg-slate-900/20"
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-950/40 border border-emerald-800/40 flex items-center justify-center text-emerald-400 mb-3 shadow-inner">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-200 mb-1">
              {counts.total > 0
                ? '선택한 필터 조건에 일치하는 위반 사항이 없습니다.'
                : activeParagraph
                ? '검수 완료: 위반 사항 없음 (Clean)'
                : editorConnected
                ? '상시 모니터링 활성화됨'
                : '에디터 연결 대기 중'}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm leading-relaxed mb-3">
              {counts.total > 0
                ? '필터 설정을 "전체"로 변경하거나 검색어를 재설정해 보세요.'
                : activeParagraph
                ? '현재 수신된 문단에서 용어 혼용, 번역투, 맞춤법 등의 위반 사항이 감지되지 않았습니다.'
                : 'Word 또는 InDesign에서 문단을 작성하거나 수정하면, 백그라운드 LLM이 실시간으로 검수한 후 변경 제안 카드를 표시합니다.'}
            </p>
            <div className="flex items-center gap-2 text-[11px] font-mono text-indigo-300/80 bg-indigo-950/40 px-3 py-1.5 rounded-md border border-indigo-800/40">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Micro-Scoping &amp; No Samples 엔진 대기 중</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
