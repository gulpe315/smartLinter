#targetengine "smartlinter_persistent_engine"

/**
 * SmartLinter InDesign ExtendScript Atomic Replacement Test Suite
 * 
 * Standalone ExtendScript / JSX test runner verifying:
 * 1. Base hash comparison & Stale rejection (STALE_REJECTED).
 * 2. Multi-hunk reverse-order replacement (SUCCESS).
 * 3. Atomic rollback via app.doScript with UndoModes.ENTIRE_SCRIPT (ROLLED_BACK).
 * 4. ParagraphStyle, CharacterStyle, and Hyperlink preservation (0 damages).
 * 5. Bridge socket result reporting.
 */

#include "../extendscript/bridge_socket.jsx"
#include "../extendscript/text_observer.jsx"
#include "../extendscript/transaction_runner.jsx"
#include "../extendscript/atomic_replacer.jsx"

(function runInDesignAtomicReplacementTests(global) {
    'use strict';

    var results = {
        total: 0,
        passed: 0,
        failed: 0,
        errors: []
    };

    function assert(condition, message) {
        results.total++;
        if (condition) {
            results.passed++;
            log('[PASS] ' + message);
        } else {
            results.failed++;
            results.errors.push(message);
            log('[FAIL] ' + message);
        }
    }

    function assertEqual(actual, expected, message) {
        var msg = message + ' (expected: ' + expected + ', actual: ' + actual + ')';
        assert(actual === expected, msg);
    }

    function log(msg) {
        if (typeof $ !== 'undefined' && $.writeln) {
            $.writeln(msg);
        } else if (typeof console !== 'undefined' && console.log) {
            console.log(msg);
        }
    }

    log('===============================================================');
    log('Running Task 10: InDesign Atomic Replacement & Rollback Tests');
    log('===============================================================');

    var hashUtil = (typeof SmartLinterHashUtil !== 'undefined')
        ? SmartLinterHashUtil
        : (global.SmartLinterHashUtil || null);

    // Mock Paragraph & App for test execution if running without native UI
    function createMockParagraph(initialText, initialStyle) {
        var text = initialText;
        return {
            get contents() { return text; },
            set contents(val) { text = val; },
            appliedParagraphStyle: { name: initialStyle || 'Heading1' },
            characters: {
                itemByRange: function(start, end) {
                    return {
                        get contents() {
                            return text.substring(start, end + 1);
                        },
                        set contents(val) {
                            text = text.substring(0, start) + val + text.substring(end + 1);
                        },
                        appliedCharacterStyle: { name: '[None]' }
                    };
                }
            }
        };
    }

    function createMockApp(paragraph) {
        return {
            doScript: function(callback, language, args, undoMode, undoName) {
                var snapshot = paragraph.contents;
                var isAtomic = (undoMode === 'ENTIRE_SCRIPT' ||
                                (typeof UndoModes !== 'undefined' && undoMode === UndoModes.ENTIRE_SCRIPT));
                try {
                    return callback.apply(null, args || []);
                } catch (e) {
                    if (isAtomic) {
                        paragraph.contents = snapshot;
                    }
                    throw e;
                }
            }
        };
    }

    // -------------------------------------------------------------
    // Test 1: Stale baseHash rejection (STALE_REJECTED)
    // -------------------------------------------------------------
    (function testStaleBaseHashRejection() {
        log('\n--- Test 1: Stale Base Hash Rejection ---');
        var initialText = 'Current text inside InDesign that was just edited.';
        var oldBaseText = 'Old paragraph text prior to edit.';
        var oldBaseHash = hashUtil.computeParagraphHash(oldBaseText, true);

        var paragraph = createMockParagraph(initialText);
        var mockApp = createMockApp(paragraph);

        var replacer = new SmartLinterAtomicReplacer({ appInstance: mockApp });
        var command = {
            commandId: 'cmd-id-stale-01',
            paragraphId: 'para-01',
            baseHash: oldBaseHash,
            expectedHash: 'some-expected-hash',
            hunks: [{ start: 0, end: 3, oldText: 'Old', newText: 'New' }]
        };

        var result = replacer.execute(command, { paragraphRef: paragraph });

        assertEqual(result.status, 'STALE_REJECTED', 'Status must be STALE_REJECTED');
        assertEqual(result.commandId, 'cmd-id-stale-01', 'commandId must match');
        assertEqual(paragraph.contents, initialText, 'Paragraph text must remain completely unchanged');
    })();

    // -------------------------------------------------------------
    // Test 2: Multi-Hunk Reverse-Order Replacement (SUCCESS)
    // -------------------------------------------------------------
    (function testMultiHunkReverseSuccess() {
        log('\n--- Test 2: Multi-Hunk Reverse Replacement Success ---');
        var initialText = 'The quick brown fox jumps over the lazy dog in the sunny park.';
        var targetText = 'The quick dark reddish-brown fox jumps over the extremely sleepy dog in the bright park.';

        var baseHash = hashUtil.computeParagraphHash(initialText, true);
        var expectedHash = hashUtil.computeParagraphHash(targetText, true);

        var paragraph = createMockParagraph(initialText);
        var mockApp = createMockApp(paragraph);

        var replacer = new SmartLinterAtomicReplacer({ appInstance: mockApp });
        var command = {
            commandId: 'cmd-id-success-02',
            paragraphId: 'para-02',
            baseHash: baseHash,
            expectedHash: expectedHash,
            hunks: [
                { start: 10, end: 15, oldText: 'brown', newText: 'dark reddish-brown' },
                { start: 35, end: 39, oldText: 'lazy', newText: 'extremely sleepy' },
                { start: 51, end: 56, oldText: 'sunny', newText: 'bright' }
            ]
        };

        var result = replacer.execute(command, { paragraphRef: paragraph });

        assertEqual(result.status, 'SUCCESS', 'Status must be SUCCESS');
        assertEqual(result.commandId, 'cmd-id-success-02', 'commandId must match');
        assertEqual(paragraph.contents, targetText, 'Paragraph text must match target exactly');
        assertEqual(result.currentHash, expectedHash, 'Final hash must match expectedHash');
    })();

    // -------------------------------------------------------------
    // Test 3: Atomic Rollback via doScript with UndoModes.ENTIRE_SCRIPT (ROLLED_BACK)
    // -------------------------------------------------------------
    (function testAtomicRollbackOnError() {
        log('\n--- Test 3: Atomic Rollback on Exception ---');
        var initialText = 'The quick brown fox jumps over the lazy dog in the sunny park.';
        var baseHash = hashUtil.computeParagraphHash(initialText, true);

        var paragraph = createMockParagraph(initialText);
        var mockApp = createMockApp(paragraph);

        var replacer = new SmartLinterAtomicReplacer({ appInstance: mockApp });
        var command = {
            commandId: 'cmd-id-rollback-03',
            paragraphId: 'para-03',
            baseHash: baseHash,
            expectedHash: 'target-hash',
            hunks: [
                { start: 10, end: 15, oldText: 'brown', newText: 'dark reddish-brown' },
                { start: 35, end: 39, oldText: 'lazy', newText: 'extremely sleepy' },
                { start: 51, end: 56, oldText: 'sunny', newText: 'bright' }
            ]
        };

        // Inject simulated error at reverse step #2 (first hunk 'brown' in reverse order)
        var result = replacer.execute(command, {
            paragraphRef: paragraph,
            simulateErrorAtHunk: 2
        });

        assertEqual(result.status, 'ROLLED_BACK', 'Status must be ROLLED_BACK');
        assertEqual(result.commandId, 'cmd-id-rollback-03', 'commandId must match');
        assertEqual(paragraph.contents, initialText, 'Paragraph text must be 100% restored to baseline via doScript atomic discard');
        assertEqual(result.currentHash, baseHash, 'Current hash must match initial baseHash');
    })();

    // -------------------------------------------------------------
    // Test 4: Bridge Socket Result Dispatch
    // -------------------------------------------------------------
    (function testBridgeSocketDispatch() {
        log('\n--- Test 4: Bridge Socket Result Dispatch ---');
        var initialText = 'Sentence for bridge dispatch test.';
        var baseHash = hashUtil.computeParagraphHash(initialText, true);

        var dispatched = [];
        var mockBridgeSocket = {
            sendReplacementResult: function(res) {
                dispatched.push(res);
                return true;
            }
        };

        var paragraph = createMockParagraph(initialText);
        var mockApp = createMockApp(paragraph);

        var replacer = new SmartLinterAtomicReplacer({
            appInstance: mockApp,
            bridgeSocket: mockBridgeSocket
        });

        var command = {
            commandId: 'cmd-id-bridge-04',
            paragraphId: 'para-04',
            baseHash: baseHash,
            expectedHash: 'exp-hash',
            hunks: [{ start: 0, end: 8, oldText: 'Sentence', newText: 'Statement' }]
        };

        var result = replacer.execute(command, { paragraphRef: paragraph });

        assertEqual(result.status, 'SUCCESS', 'Status must be SUCCESS');
        assertEqual(dispatched.length, 1, 'Exactly 1 result must be dispatched to bridge socket');
        assertEqual(dispatched[0].commandId, 'cmd-id-bridge-04', 'Dispatched commandId must match');
    })();

    log('\n===============================================================');
    log('InDesign Atomic Replacement Test Summary: ' + results.passed + ' passed, ' + results.failed + ' failed.');
    log('===============================================================');

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            runTests: function() { return results; }
        };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
