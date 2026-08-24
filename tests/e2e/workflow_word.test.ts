/**
 * Task 19 E2E Integration Test: MS Word Complete Workflow
 *
 * Scenarios:
 * 1. Scenario 1 (Default QA Cycle): Paragraph input -> 0.1s TM match -> Async Live Ollama LLM QA -> [Accept] -> Lossless reverse-order multi-hunk replacement.
 * 2. Scenario 2 (Stale Conflict Auto-Rescan): Text modified in editor after analysis -> [Accept] receives STALE_REJECTED -> Single-paragraph auto-rescan & card update.
 * 3. Scenario 3 (Rollback & Fallback Safety Net): Fault injected during replacement -> Compensating transaction rollback to baseline / RollbackGuard safe abort.
 * 4. Scenario 4 (No-UI Background Persistence): Office.addin.hide() state with continuous multi-cycle idle monitoring loop.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import { MockWordHost } from './harness/mock_word_host.ts';
import { WordReplacementExecutor } from '../../plugins/word/src/replacement_executor.ts';
import { WordDocumentListener } from '../../plugins/word/src/document_listener.ts';
import { WordRuntimeManager } from '../../plugins/word/src/runtime_manager.ts';

import { useQaStore } from '../../src/stores/qaStore.ts';
import { useTmStore } from '../../src/stores/tmStore.ts';
import { useBridgeStore } from '../../src/stores/bridgeStore.ts';
import { useConfigStore } from '../../src/stores/configStore.ts';
import { MockBridgeService, type IBridgeService } from '../../src/services/tauriBridge.ts';
import { resetStaleConflictResolver } from '../../src/services/stale_conflict_resolver.ts';
import { resetRollbackGuard } from '../../src/services/rollback_guard.ts';
import { computeParagraphHash } from '../../shared/engine/hash_util.ts';
import {
    type ParagraphPayload,
    type ReplacementCommand,
    type ReplacementResult,
    type QaReport,
} from '../../shared/protocol/types.ts';

/**
 * Live Ollama Caller for Scenario 1
 */
async function callLiveOllamaQa(source: string, target: string, model = 'qwen2.5:7b'): Promise<QaReport> {
    const systemPrompt =
        'You are a fast paragraph QA linter. Check Korean target against source for terminology, grammar, passive voice, numbers, and punctuation.\nOutput JSON only matching this schema:\n{"status":"PASS"|"FAIL","issues":[{"category":"...","originalSegment":"...","suggestedSegment":"...","reason":"...","severity":"LOW"|"MEDIUM"|"HIGH"}]}';
    const userPrompt = `SRC: ${source}\nTGT: ${target}`;

    const res = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            system: systemPrompt,
            prompt: userPrompt,
            format: 'json',
            stream: false,
            options: {
                temperature: 0.1,
                num_ctx: 2048,
            },
        }),
    });

    if (!res.ok) {
        throw new Error(`Ollama live call failed with status: ${res.statusText}`);
    }

    const data = (await res.json()) as { response: string };
    const rawText = data.response.trim();

    let parsed: any;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        const cleaned = rawText.replace(/```json\s*|\s*```/g, '').trim();
        parsed = JSON.parse(cleaned);
    }

    const issues = (parsed.issues || []).map((iss: any) => ({
        category: iss.category || iss.rule || 'General',
        originalSegment: iss.originalSegment || iss.original || '',
        suggestedSegment: iss.suggestedSegment || iss.suggestion || '',
        reason: iss.reason || '',
        severity: (iss.severity || 'MEDIUM').toUpperCase(),
    }));

    const status = parsed.status === 'FAIL' || issues.length > 0 ? 'FAIL' : 'PASS';
    return { status, issues, raw_response: rawText };
}

describe('Task 19: MS Word E2E Integrated Workflow', () => {
    let mockWordHost: MockWordHost;
    let bridgeService: MockBridgeService;
    let executor: WordReplacementExecutor;

    beforeEach(() => {
        useQaStore.getState().reset();
        useTmStore.getState().reset();
        useBridgeStore.getState().reset();
        useConfigStore.getState().reset();
        resetStaleConflictResolver();
        resetRollbackGuard();

        mockWordHost = new MockWordHost(
            '데이터베이스 스냅샷은 24시간마다 자동적으로 생성되어지는 구조이며 백업되어지게 됩니다.',
            'Manual_KR.docx'
        );
        bridgeService = new MockBridgeService();
        executor = new WordReplacementExecutor();
    });

    // =========================================================================
    // Scenario 1: Default QA Cycle
    // Paragraph input -> 0.1s TM match -> Live Ollama LLM QA -> Accept -> Lossless Reverse Replacement
    // =========================================================================
    it('Scenario 1: Default QA Cycle with Live Ollama (qwen2.5:7b) and TM Match', async () => {
        const sourceText = 'The database snapshot is automatically created every 24 hours and backed up.';
        const targetText = mockWordHost.getParagraphText();
        const initialHash = mockWordHost.getParagraphHash();

        // 1. Setup TM in-memory entry (supporting both source matching and fuzzy matching)
        await useConfigStore.getState().loadTmText(
            JSON.stringify([
                {
                    source: '데이터베이스 스냅샷은 24시간마다 자동적으로 생성되어지는 구조이며 백업되어지게 됩니다.',
                    target: '데이터베이스 스냅샷은 매 24시간마다 자동으로 생성 및 백업됩니다.',
                },
                {
                    source: 'The database snapshot is automatically created every 24 hours and backed up.',
                    target: '데이터베이스 스냅샷은 매 24시간마다 자동으로 생성 및 백업됩니다.',
                },
            ]),
            'cloud_terms.json'
        );

        // 2. Word document listener captures paragraph & emits telemetry
        const listener = new WordDocumentListener({
            bridgeClient: {
                sendParagraphPayload: async (p: ParagraphPayload) => {
                    useBridgeStore.getState().setActiveParagraph(p);
                    bridgeService.emit('new-paragraph-detected', p);
                },
            } as any,
            idleDebounceMs: 10,
            wordRunner: mockWordHost.createWordRunner(),
            documentSource: 'Manual_KR.docx',
        });

        await listener.start();
        listener.handleSelectionChanged();
        const capturedPayload = await listener.flushDebounce();

        assert.ok(capturedPayload, 'ParagraphPayload must be captured');
        assert.strictEqual(capturedPayload.text, targetText);
        assert.strictEqual(capturedPayload.hash, initialHash);

        // 3. Fast TM Fuzzy Matching (< 100ms)
        const tmStartTime = performance.now();
        const tmCandidates = await useTmStore.getState().search(capturedPayload.text);
        const tmDuration = performance.now() - tmStartTime;

        assert.ok(tmDuration < 100, `TM matching must execute within 100ms (took ${tmDuration.toFixed(2)}ms)`);
        assert.ok(tmCandidates.length > 0, 'TM candidate must be found');
        assert.ok(tmCandidates[0].score >= 0.5, 'TM candidate similarity score should be high');

        // 4. Asynchronous Live LLM QA analysis via actual local Ollama (qwen2.5:7b)
        console.log('   [Scenario 1] Invoking Live Ollama (127.0.0.1:11434 / qwen2.5:7b)...');
        const liveQaReport = await callLiveOllamaQa(sourceText, targetText);

        console.log(`   [Scenario 1] Live Ollama returned status: ${liveQaReport.status}, ${liveQaReport.issues.length} issue(s)`);
        assert.ok(liveQaReport.issues.length > 0, 'Live Ollama should detect passive voice / wordy issues');

        // Add report to QA store
        useQaStore.getState().addReport({
            paragraphId: capturedPayload.paragraphId,
            paragraphText: capturedPayload.text,
            paragraphHash: capturedPayload.hash,
            report: liveQaReport,
        });

        const cards = useQaStore.getState().cards;
        assert.ok(cards.length > 0, 'QA card must be rendered in store');
        const primaryCard = cards[0];

        // 5. User clicks [Accept] on the QA Card
        const customService: IBridgeService = {
            ...bridgeService,
            sendReplacementCommand: async (cmd: ReplacementCommand): Promise<ReplacementResult> => {
                const adapter = mockWordHost.createAdapter();
                return await executor.execute(cmd, { adapter });
            },
        };

        const acceptResult = await useQaStore.getState().acceptCard(primaryCard.id, customService);

        assert.ok(acceptResult, 'AcceptCard must return a ReplacementResult');
        assert.strictEqual(acceptResult.status, 'SUCCESS', 'Replacement should succeed');

        // 6. Verify Word Host text was modified cleanly without loss
        const finalText = mockWordHost.getParagraphText();
        const finalHash = mockWordHost.getParagraphHash();

        assert.notStrictEqual(finalText, targetText, 'Paragraph text in Word host must be updated');
        assert.strictEqual(finalHash, acceptResult.currentHash, 'Hash in Word host must match result');

        // Verify applied card state
        assert.strictEqual(useQaStore.getState().appliedCards.length, 1, 'Card must be moved to appliedCards');
        assert.strictEqual(useQaStore.getState().cards.length, cards.length - 1, 'Active cards count decreased');

        await listener.stop();
    });

    // =========================================================================
    // Scenario 2: Stale Conflict Auto-Rescan
    // Post-analysis text modification in editor -> STALE_REJECTED -> Single-paragraph auto-rescan
    // =========================================================================
    it('Scenario 2: Stale Conflict Rejection and Single-Paragraph Auto-Rescan UX', async () => {
        const initialText = '설정 마법사에서 3 으로 옵션을 지정 하세요 .';
        mockWordHost.setParagraphText(initialText);

        const paragraphId = 'para-stale-test-01';
        const initialHash = mockWordHost.getParagraphHash();

        // 1. Initial QA card created
        const cardId = useQaStore.getState().addCard({
            paragraphId,
            paragraphHash: initialHash,
            paragraphText: initialText,
            category: '맞춤법',
            originalSegment: '3 으로',
            suggestedSegment: '3으로',
            reason: '조사 앞 공백 제거',
            severity: 'LOW',
        });

        // 2. User modifies text in Word editor while card was displayed
        const modifiedText = '설정 마법사에서 3 으로 옵션을 변경 하세요 . (사용자 직접 편집)';
        mockWordHost.simulateUserEdit(modifiedText);
        const modifiedHash = mockWordHost.getParagraphHash();

        // Sync active paragraph in bridge store
        useBridgeStore.getState().setActiveParagraph(
            mockWordHost.createParagraphPayload(paragraphId)
        );

        assert.notStrictEqual(initialHash, modifiedHash, 'Hash must change after user edit');

        // 3. User clicks [Accept] on stale card
        const customService: IBridgeService = {
            ...bridgeService,
            sendReplacementCommand: async (cmd: ReplacementCommand): Promise<ReplacementResult> => {
                const adapter = mockWordHost.createAdapter();
                return await executor.execute(cmd, { adapter });
            },
            analyzeParagraph: async (p: ParagraphPayload): Promise<QaReport> => {
                // Mock background rescan report for the modified text
                return {
                    status: 'FAIL',
                    issues: [
                        {
                            category: '맞춤법',
                            originalSegment: '3 으로',
                            suggestedSegment: '3으로',
                            reason: '최신 텍스트 기준 조사 앞 공백 제거',
                            severity: 'LOW',
                        },
                    ],
                };
            },
        };

        const result = await useQaStore.getState().acceptCard(cardId, customService, {
            autoResolveStale: true,
        });

        assert.ok(result, 'Result must be returned');
        assert.strictEqual(result.status, 'STALE_REJECTED', 'Executor must reject stale baseHash');

        // 4. StaleConflictResolver automatically rescanned the single paragraph
        const currentCards = useQaStore.getState().cards;
        const refreshedCard = currentCards.find((c) => c.id === cardId);

        assert.ok(refreshedCard, 'Card should still exist and be updated');
        assert.strictEqual(refreshedCard.isStale, false, 'isStale flag must be cleared after rescan');
        assert.strictEqual(refreshedCard.status, 'pending', 'Status must return to pending with fresh diff');
        assert.strictEqual(refreshedCard.paragraphHash, modifiedHash, 'Card hash must be refreshed to modified text hash');
        assert.strictEqual(refreshedCard.paragraphText, modifiedText, 'Card paragraph text must be updated');
    });

    // =========================================================================
    // Scenario 3: Rollback & Fallback Safety Net
    // Replacement exception injection -> 100% compensating rollback to baseline & RollbackGuard alert
    // =========================================================================
    it('Scenario 3: Compensating Transaction Rollback & RollbackGuard Safety Net', async () => {
        const originalText = '서버 인스턴스가 생성되어지게 되면 레플리카 카운트가 3 으로 설정 하세요 .';
        mockWordHost.setParagraphText(originalText);
        const baseHash = mockWordHost.getParagraphHash();

        const cardId = useQaStore.getState().addCard({
            paragraphId: 'para-rollback-01',
            paragraphHash: baseHash,
            paragraphText: originalText,
            category: '번역투',
            originalSegment: '생성되어지게 되면',
            suggestedSegment: '생성되면',
            reason: '이중 피동 지양',
            severity: 'HIGH',
        });

        // 1. Case A: Exception injected at Hunk #0 -> 100% Compensating Rollback
        const failingService: IBridgeService = {
            ...bridgeService,
            sendReplacementCommand: async (cmd: ReplacementCommand): Promise<ReplacementResult> => {
                const adapter = mockWordHost.createAdapter();
                // Inject failure at step #0
                return await executor.execute(cmd, {
                    adapter,
                    simulateErrorAtHunk: 0,
                });
            },
        };

        const resultA = await useQaStore.getState().acceptCard(cardId, failingService);

        assert.ok(resultA, 'Result must be returned');
        assert.ok(
            resultA.status === 'ROLLED_BACK' || resultA.status === 'FAILED',
            `Status should indicate recovery: ${resultA.status}`
        );

        // Document state must be 100% restored to original text
        assert.strictEqual(mockWordHost.getParagraphText(), originalText, 'Word host text must be 100% restored');
        assert.strictEqual(mockWordHost.getParagraphHash(), baseHash, 'Word host hash must be 100% restored');

        // Card should display rollback alert notification
        const cardA = useQaStore.getState().cards.find((c) => c.id === cardId);
        assert.ok(cardA, 'Card must remain in store');
        assert.ok(
            cardA.status === 'rolled_back' || cardA.status === 'failed',
            `Card status should reflect rollback: ${cardA.status}`
        );

        // 2. Case B: External editing occurs right before rollback -> ROLLBACK_ABORTED defense
        useQaStore.getState().retryCard(cardId);

        const multiCardId = useQaStore.getState().addCard({
            paragraphId: 'para-rollback-02',
            paragraphHash: baseHash,
            paragraphText: originalText,
            category: '용어 혼용',
            originalSegment: '레플리카 카운트가 3 으로',
            suggestedSegment: '복제본 수가 3으로',
            reason: '표준 용어',
            severity: 'HIGH',
        });

        const abortService: IBridgeService = {
            ...bridgeService,
            sendReplacementCommand: async (cmd: ReplacementCommand): Promise<ReplacementResult> => {
                const adapter = mockWordHost.createAdapter();
                return await executor.execute(cmd, {
                    adapter,
                    simulateErrorAtHunk: 0,
                    simulateExternalEditBeforeRollback: ' [USER_INTERFERENCE]',
                });
            },
        };

        const resultB = await useQaStore.getState().acceptCard(multiCardId, abortService);

        assert.ok(resultB);
        assert.ok(
            resultB.status === 'ROLLBACK_ABORTED' || resultB.status === 'FAILED',
            `Status: ${resultB.status}`
        );

        const cardB = useQaStore.getState().cards.find((c) => c.id === multiCardId);
        assert.ok(cardB);
    });

    // =========================================================================
    // Scenario 4: No-UI Background Persistence
    // Office.addin.hide() state with continuous multi-cycle idle monitoring loop
    // =========================================================================
    it('Scenario 4: No-UI Background Persistence and Multi-Cycle Monitoring Loop', async () => {
        // 1. Initialize Runtime Manager and hide Taskpane
        const runtimeMgr = new WordRuntimeManager({
            officeHost: mockWordHost.office as any,
            autoHideOnStartup: true,
            autoSetStartupBehavior: true,
        });
        await runtimeMgr.initialize();

        assert.strictEqual(mockWordHost.addin.hideCallCount, 1, 'Office.addin.hide() must be called on launch');
        assert.strictEqual(mockWordHost.addin.visibilityMode, 'Hidden', 'Visibility mode must be Hidden');
        assert.strictEqual(runtimeMgr.getVisibility(), 'Hidden', 'Taskpane visibility must be Hidden');

        // 2. Start Word Document Listener in hidden mode
        let capturedEventsCount = 0;
        const capturedTexts: string[] = [];

        const listener = new WordDocumentListener({
            bridgeClient: {
                sendParagraphPayload: async (payload: ParagraphPayload) => {
                    capturedEventsCount++;
                    capturedTexts.push(payload.text);
                },
            } as any,
            idleDebounceMs: 5,
            wordRunner: mockWordHost.createWordRunner(),
            documentSource: 'BackgroundDoc.docx',
        });

        await listener.start();
        assert.strictEqual(listener.isActive(), true, 'Listener must be active even with hidden taskpane');

        // 3. Simulate N continuous editing/cursor movement cycles
        const CYCLE_COUNT = 20;
        for (let i = 0; i < CYCLE_COUNT; i++) {
            const cycleText = `Continuous background monitoring cycle paragraph content #${i + 1}.`;
            mockWordHost.setParagraphText(cycleText);
            listener.handleSelectionChanged();
            await listener.flushDebounce();
        }

        // 4. Verify all cycles were captured continuously without event loop termination
        assert.strictEqual(
            capturedEventsCount,
            CYCLE_COUNT,
            `All ${CYCLE_COUNT} background cycles must be successfully captured`
        );
        assert.strictEqual(
            capturedTexts[capturedTexts.length - 1],
            `Continuous background monitoring cycle paragraph content #${CYCLE_COUNT}.`
        );
        assert.strictEqual(
            mockWordHost.addin.visibilityMode,
            'Hidden',
            'Addin must have stayed hidden throughout all cycles'
        );

        await listener.stop();
        assert.strictEqual(listener.isActive(), false, 'Listener cleanly stopped');
        await runtimeMgr.shutdown();
    });
});
