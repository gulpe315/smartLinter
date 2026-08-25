#targetengine "smartlinter_persistent_engine"

/**
 * SmartLinter InDesign ExtendScript Atomic Replacer
 * 
 * Implements:
 * 1. Stale paragraph rejection via SHA-256 baseHash verification (STALE_REJECTED).
 * 2. Multi-Hunk reverse-order text replacement (high offset -> low offset).
 * 3. Atomic transaction execution and 100% automatic rollback via app.doScript (UndoModes.ENTIRE_SCRIPT).
 * 4. Zero corruption of character styles, paragraph styles, hyperlinks, and special characters.
 * 5. ReplacementResult formatting and bridge server dispatch.
 */

#include "bridge_socket.jsx"
#include "text_observer.jsx"
#include "transaction_runner.jsx"

(function(global) {
    'use strict';

    /**
     * Helper to get HashUtil functions
     */
    function getHashUtil() {
        if (typeof SmartLinterHashUtil !== 'undefined') {
            return SmartLinterHashUtil;
        }
        if (global && global.SmartLinterHashUtil) {
            return global.SmartLinterHashUtil;
        }
        if (typeof SmartLinterTextObserver !== 'undefined') {
            var obs = new SmartLinterTextObserver();
            return {
                computeParagraphHash: function(t, n) { return obs.computeHash(t, n); },
                normalizeParagraph: function(t) { return obs.normalize(t); }
            };
        }
        throw new Error('SmartLinterHashUtil / SmartLinterTextObserver is not available');
    }

    /**
     * Finds a paragraph from the stable identifier emitted by TextObserver.
     *
     * TextObserver creates ids as `indesign-para-{storyId}-{paragraphIndex}`.
     * Story ids are InDesign-assigned values and must be treated as opaque: split
     * at the final dash so this also remains safe for mock/custom story ids that
     * contain dashes.
     *
     * @param {Object} doc InDesign Document reference
     * @param {string} paragraphId Stable paragraph identifier
     * @returns {Object|null} InDesign Paragraph reference, or null when absent
     */
    function findParagraphById(doc, paragraphId) {
        var prefix = 'indesign-para-';
        if (!doc || typeof paragraphId !== 'string' || paragraphId.indexOf(prefix) !== 0) {
            return null;
        }

        var idSuffix = paragraphId.substring(prefix.length);
        var separator = idSuffix.lastIndexOf('-');
        if (separator <= 0) {
            return null;
        }

        var storyId = idSuffix.substring(0, separator);
        var indexText = idSuffix.substring(separator + 1);
        if (!/^\d+$/.test(indexText)) {
            return null;
        }

        var paragraphIndex = parseInt(indexText, 10);
        try {
            if (!doc.stories || typeof doc.stories.itemByID !== 'function') {
                return null;
            }

            var story = doc.stories.itemByID(storyId);
            if (!story || story.isValid === false || !story.paragraphs ||
                    paragraphIndex < 0 || paragraphIndex >= story.paragraphs.length) {
                return null;
            }

            var paragraph = story.paragraphs[paragraphIndex];
            return (!paragraph || paragraph.isValid === false) ? null : paragraph;
        } catch (e) {
            // itemByID and unresolved DOM specifiers can throw in InDesign.
            return null;
        }
    }

    /**
     * SmartLinterAtomicReplacer constructor
     * @param {Object} [config]
     */
    function SmartLinterAtomicReplacer(config) {
        config = config || {};
        this.appInstance = config.appInstance || (typeof app !== 'undefined' ? app : null);
        this.bridgeSocket = config.bridgeSocket || null;

        var RunnerClass = (typeof SmartLinterTransactionRunner !== 'undefined')
            ? SmartLinterTransactionRunner
            : (global.SmartLinterTransactionRunner || null);

        if (config.transactionRunner) {
            this.transactionRunner = config.transactionRunner;
        } else if (RunnerClass) {
            this.transactionRunner = new RunnerClass({ appInstance: this.appInstance });
        } else {
            this.transactionRunner = null;
        }

        var ObserverClass = (typeof SmartLinterTextObserver !== 'undefined')
            ? SmartLinterTextObserver
            : (global.SmartLinterTextObserver || null);

        if (config.textObserver) {
            this.textObserver = config.textObserver;
        } else if (ObserverClass) {
            this.textObserver = new ObserverClass();
        } else {
            this.textObserver = null;
        }
    }

    /**
     * Normalizes a hunk object to standard start/end format
     * @param {Object} hunk
     * @returns {{ start: number, end: number, oldText: string, newText: string }}
     */
    SmartLinterAtomicReplacer.prototype.normalizeHunk = function(hunk) {
        var start = (typeof hunk.start !== 'undefined') ? hunk.start : hunk.startOffset;
        var end = (typeof hunk.end !== 'undefined') ? hunk.end : hunk.endOffset;
        return {
            start: start,
            end: end,
            oldText: (typeof hunk.oldText === 'string') ? hunk.oldText : '',
            newText: (typeof hunk.newText === 'string') ? hunk.newText : ''
        };
    };

    /**
     * Validates an array of hunks against current paragraph text
     * @param {string} text
     * @param {Array} hunks
     * @returns {{ valid: boolean, errors: string[] }}
     */
    SmartLinterAtomicReplacer.prototype.validateHunks = function(text, hunks) {
        var errors = [];
        if (!hunks || !hunks.length) {
            return { valid: true, errors: [] };
        }

        for (var i = 0; i < hunks.length; i++) {
            var h = this.normalizeHunk(hunks[i]);
            if (typeof h.start !== 'number' || typeof h.end !== 'number') {
                errors.push('Hunk #' + i + ' missing numeric start/end offset');
                continue;
            }
            if (h.start < 0 || h.end < h.start || h.end > text.length) {
                errors.push('Hunk #' + i + ' out of bounds: [' + h.start + ':' + h.end + '], text length=' + text.length);
                continue;
            }
            var slice = text.substring(h.start, h.end);
            if (slice !== h.oldText) {
                errors.push('Hunk #' + i + ' text mismatch at [' + h.start + ':' + h.end + ']: expected "' + h.oldText + '", found "' + slice + '"');
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    };

    /**
     * Converts an InDesign text contents value to a string.
     *
     * A plural Characters specifier returns an array of strings from `.contents`
     * in ExtendScript, whereas a resolved singular Text object returns a string.
     *
     * @param {String|Array} contents
     * @returns {string}
     */
    SmartLinterAtomicReplacer.prototype.normalizeContents = function(contents) {
        if (contents && typeof contents === 'object' && typeof contents.join === 'function') {
            return contents.join('');
        }
        return (typeof contents === 'undefined' || contents === null) ? '' : String(contents);
    };

    // Public for callers/tests that need to resolve a telemetry paragraph id.
    SmartLinterAtomicReplacer.prototype.findParagraphById = function(doc, paragraphId) {
        return findParagraphById(doc, paragraphId);
    };

    /**
     * Applies a single hunk mutation to an InDesign Paragraph DOM element.
     * Preserves character styles, paragraph styles, hyperlinks, and special elements.
     * 
     * @param {Object} paragraph InDesign Paragraph reference
     * @param {number} start 0-based start character offset
     * @param {number} end 0-based end character offset (exclusive)
     * @param {string} oldText Expected current slice
     * @param {string} newText Replacement text
     */
    SmartLinterAtomicReplacer.prototype.applyHunkToParagraph = function(paragraph, start, end, oldText, newText) {
        if (!paragraph) {
            throw new Error('Target paragraph DOM reference is invalid');
        }

        // Case 1: Pure Insertion (start === end)
        if (start === end) {
            if (paragraph.insertionPoints && paragraph.insertionPoints.length > start) {
                paragraph.insertionPoints[start].contents = newText;
                return;
            }
            if (paragraph.characters && start === 0) {
                if (paragraph.insertionPoints && paragraph.insertionPoints.length > 0) {
                    paragraph.insertionPoints[0].contents = newText;
                    return;
                }
            }
        }

        // Case 2: Range Replacement or Deletion (end > start)
        if (paragraph.characters && paragraph.characters.itemByRange) {
            // InDesign itemByRange is 0-based inclusive for both start and end
            var charRange = paragraph.characters.itemByRange(start, end - 1);
            var currentContent = this.normalizeContents(charRange.contents);

            if (currentContent !== oldText) {
                throw new Error('InDesign DOM range mismatch: expected "' + oldText + '" at [' + start + ':' + end + '], found "' + currentContent + '"');
            }

            // `charRange` is a plural Characters specifier. Resolve its single Text
            // object before assigning so the documented String `Text.contents` API is
            // used rather than relying on plural-specifier assignment semantics.
            var rangeText = null;
            if (charRange.texts && charRange.texts.everyItem) {
                var resolvedTexts = charRange.texts.everyItem().getElements();
                if (resolvedTexts && resolvedTexts.length > 0) {
                    rangeText = resolvedTexts[0];
                }
            }

            if (rangeText) {
                rangeText.contents = newText;
            } else {
                // Compatibility fallback for lightweight DOM adapters.
                charRange.contents = newText;
            }
            return;
        }

        // Fallback for mock/plain string environments
        if (typeof paragraph.contents === 'string') {
            var raw = paragraph.contents;
            var slice = raw.substring(start, end);
            if (slice !== oldText) {
                throw new Error('Paragraph text mismatch: expected "' + oldText + '", found "' + slice + '"');
            }
            paragraph.contents = raw.substring(0, start) + newText + raw.substring(end);
            return;
        }

        throw new Error('InDesign Paragraph object does not support character range replacement');
    };

    /**
     * Executes a ReplacementCommand on the target InDesign paragraph with full:
     * - Stale paragraph detection via SHA-256 baseHash verification (STALE_REJECTED)
     * - Multi-Hunk reverse-order text replacement (Reverse Order: high -> low offset)
     * - Native InDesign app.doScript atomic undo rollback on error (UndoModes.ENTIRE_SCRIPT)
     * - Result reporting to Local Bridge Server
     * 
     * @param {Object|string} command ReplacementCommand payload
     * @param {Object} [options] Execution options
     * @returns {Object} ReplacementResult { commandId, status, currentHash, message }
     */
    SmartLinterAtomicReplacer.prototype.execute = function(command, options) {
        options = options || {};

        if (typeof command === 'string') {
            try {
                command = JSON.parse(command);
            } catch (e) {
                return {
                    commandId: 'unknown',
                    status: 'FAILED',
                    currentHash: '',
                    message: 'Invalid JSON command: ' + e.message
                };
            }
        }

        if (!command || !command.commandId || !command.hunks) {
            var invalidResult = {
                commandId: command ? (command.commandId || 'unknown') : 'unknown',
                status: 'FAILED',
                currentHash: '',
                message: 'Invalid ReplacementCommand payload structure'
            };
            this.dispatchResultIfNeeded(invalidResult, options);
            return invalidResult;
        }

        var inApp = options.appInstance || this.appInstance || (typeof app !== 'undefined' ? app : null);
        var hashUtil = getHashUtil();

        // 1. Locate target paragraph
        var targetParagraph = null;
        var currentText = '';

        var hasResolvableParagraphId = typeof command.paragraphId === 'string' &&
            command.paragraphId.indexOf('indesign-para-') === 0 &&
            command.paragraphId.substring('indesign-para-'.length).lastIndexOf('-') > 0;

        // A command's paragraphId is authoritative.  Do not let a changed
        // cursor/selection redirect a real command to another paragraph.
        if (hasResolvableParagraphId) {
            var doc = inApp ? inApp.activeDocument : null;
            targetParagraph = findParagraphById(doc, command.paragraphId);
            if (targetParagraph) {
                currentText = targetParagraph.contents || '';
            }
        }

        // These are explicit test/embedding injection paths. They intentionally
        // remain available when DOM lookup is unavailable.
        if (!targetParagraph && options.adapter && typeof options.adapter.getText === 'function') {
            currentText = options.adapter.getText();
        } else if (!targetParagraph && options.paragraphRef) {
            targetParagraph = options.paragraphRef;
            currentText = targetParagraph.contents || '';
        } else if (!targetParagraph && options.targetParagraph) {
            targetParagraph = options.targetParagraph;
            currentText = targetParagraph.contents || '';
        } else if (!hasResolvableParagraphId) {
            var activeInfo = this.textObserver ? this.textObserver.getActiveParagraph(inApp) : null;
            if (activeInfo && activeInfo.paragraphRef) {
                targetParagraph = activeInfo.paragraphRef;
                currentText = activeInfo.text || '';
            } else if (inApp && inApp.selection && inApp.selection.length > 0) {
                var sel = inApp.selection[0];
                if (sel.paragraphs && sel.paragraphs.length > 0) {
                    targetParagraph = sel.paragraphs[0];
                    currentText = targetParagraph.contents || '';
                } else if (sel.texts && sel.texts.length > 0 && sel.texts[0].paragraphs && sel.texts[0].paragraphs.length > 0) {
                    targetParagraph = sel.texts[0].paragraphs[0];
                    currentText = targetParagraph.contents || '';
                } else if (sel.parentStory && sel.parentStory.paragraphs && sel.parentStory.paragraphs.length > 0) {
                    targetParagraph = sel.parentStory.paragraphs[0];
                    currentText = targetParagraph.contents || '';
                }
            }
        }

        if (!targetParagraph && !options.adapter && hasResolvableParagraphId) {
            var targetIdNotFoundResult = {
                commandId: command.commandId,
                status: 'FAILED',
                currentHash: '',
                message: 'Target InDesign paragraph could not be located for paragraphId: ' + command.paragraphId
            };
            this.dispatchResultIfNeeded(targetIdNotFoundResult, options);
            return targetIdNotFoundResult;
        }

        if (!currentText && !options.adapter && !targetParagraph) {
            var notFoundResult = {
                commandId: command.commandId,
                status: 'FAILED',
                currentHash: '',
                message: 'Target InDesign paragraph could not be located in active selection or document'
            };
            this.dispatchResultIfNeeded(notFoundResult, options);
            return notFoundResult;
        }

        // 2. Base Hash Verification (Stale Conflict Defense)
        var currentHash = hashUtil.computeParagraphHash(currentText, true);

        if (command.baseHash && currentHash.toLowerCase() !== command.baseHash.toLowerCase()) {
            var staleResult = {
                commandId: command.commandId,
                status: 'STALE_REJECTED',
                currentHash: currentHash,
                message: 'Paragraph hash mismatch: document was modified (expected base: ' +
                    command.baseHash.substring(0, 12) + '..., current: ' + currentHash.substring(0, 12) + '...)'
            };
            this.dispatchResultIfNeeded(staleResult, options);
            return staleResult;
        }

        // 3. Validate Hunks against current text
        var validation = this.validateHunks(currentText, command.hunks);
        if (!validation.valid) {
            var failResult = {
                commandId: command.commandId,
                status: 'FAILED',
                currentHash: currentHash,
                message: 'Hunk validation failed: ' + validation.errors.join('; ')
            };
            this.dispatchResultIfNeeded(failResult, options);
            return failResult;
        }

        // 4. Sort Hunks in REVERSE order (high start offset -> low start offset)
        var self = this;
        var normalizedHunks = [];
        for (var hIdx = 0; hIdx < command.hunks.length; hIdx++) {
            normalizedHunks.push(this.normalizeHunk(command.hunks[hIdx]));
        }

        var sortedHunks = normalizedHunks.slice(0).sort(function(a, b) {
            if (b.start !== a.start) {
                return b.start - a.start;
            }
            return b.end - a.end;
        });

        // 5. Execute Multi-Hunk Replacement inside app.doScript with UndoModes.ENTIRE_SCRIPT
        var runner = options.transactionRunner || this.transactionRunner;
        if (!runner) {
            var RunnerConstructor = (typeof SmartLinterTransactionRunner !== 'undefined')
                ? SmartLinterTransactionRunner
                : (global.SmartLinterTransactionRunner || null);
            if (RunnerConstructor) {
                runner = new RunnerConstructor({ appInstance: inApp });
            }
        }

        var simulateErrorAtHunk = (typeof options.simulateErrorAtHunk === 'number')
            ? options.simulateErrorAtHunk
            : -1;

        var undoName = options.undoName || 'SmartLinter Multi-Hunk Replace';
        var undoMode = options.undoMode; // will default to ENTIRE_SCRIPT in transaction runner

        var txResult = null;
        if (runner) {
            txResult = runner.runInTransaction(function() {
                for (var i = 0; i < sortedHunks.length; i++) {
                    var hunk = sortedHunks[i];

                    // Simulated error injection for testing / verification
                    if (simulateErrorAtHunk === i) {
                        throw new Error('Simulated InDesign DOM mutation error at step #' + i + ' ("' + hunk.oldText + '" -> "' + hunk.newText + '")');
                    }

                    if (options.adapter && typeof options.adapter.applyHunk === 'function') {
                        options.adapter.applyHunk(hunk.start, hunk.end, hunk.oldText, hunk.newText);
                    } else if (targetParagraph) {
                        self.applyHunkToParagraph(targetParagraph, hunk.start, hunk.end, hunk.oldText, hunk.newText);
                    } else {
                        throw new Error('No target paragraph or adapter available for replacement');
                    }
                }
                return true;
            }, {
                appInstance: inApp,
                undoMode: undoMode,
                undoName: undoName
            });
        } else {
            // Direct execution fallback if runner unavailable
            try {
                for (var j = 0; j < sortedHunks.length; j++) {
                    var h = sortedHunks[j];
                    if (simulateErrorAtHunk === j) {
                        throw new Error('Simulated error at step #' + j);
                    }
                    if (options.adapter && typeof options.adapter.applyHunk === 'function') {
                        options.adapter.applyHunk(h.start, h.end, h.oldText, h.newText);
                    } else if (targetParagraph) {
                        self.applyHunkToParagraph(targetParagraph, h.start, h.end, h.oldText, h.newText);
                    }
                }
                txResult = { success: true, rolledBack: false };
            } catch (errFallback) {
                txResult = { success: false, error: errFallback.message, rolledBack: false };
            }
        }

        // 6. Post-transaction Verification & Result Generation
        var postText = '';
        if (options.adapter && typeof options.adapter.getText === 'function') {
            postText = options.adapter.getText();
        } else if (targetParagraph) {
            postText = targetParagraph.contents || '';
        }

        var postHash = hashUtil.computeParagraphHash(postText, true);
        var finalResult = null;

        if (txResult.success) {
            finalResult = {
                commandId: command.commandId,
                status: 'SUCCESS',
                currentHash: postHash,
                message: 'Successfully applied ' + sortedHunks.length + ' diff hunks in reverse order via InDesign doScript transaction'
            };
        } else {
            var resultStatus = txResult.rolledBack ? 'ROLLED_BACK' : 'FAILED';
            var rollbackDesc = txResult.rolledBack
                ? 'InDesign native UndoModes.ENTIRE_SCRIPT 100% atomic rollback executed.'
                : 'Transaction failed without atomic rollback.';

            finalResult = {
                commandId: command.commandId,
                status: resultStatus,
                currentHash: postHash,
                message: 'Replacement error encountered (' + txResult.error + '). ' + rollbackDesc
            };
        }

        // 7. Dispatch Result to Local Bridge Server
        this.dispatchResultIfNeeded(finalResult, options);

        return finalResult;
    };

    /**
     * Dispatches ReplacementResult to Bridge Socket if connected
     * @param {Object} result
     * @param {Object} [options]
     */
    SmartLinterAtomicReplacer.prototype.dispatchResultIfNeeded = function(result, options) {
        var socket = (options && options.bridgeSocket) || this.bridgeSocket;
        if (socket && typeof socket.sendReplacementResult === 'function') {
            try {
                socket.sendReplacementResult(result);
            } catch (e) {}
        }
    };

    // Register globally in ExtendScript
    if (typeof $ !== 'undefined' && $.global) {
        $.global.SmartLinterAtomicReplacer = SmartLinterAtomicReplacer;
    } else if (typeof global !== 'undefined') {
        global.SmartLinterAtomicReplacer = SmartLinterAtomicReplacer;
    }

    // CommonJS export for Node.js / unit tests
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            SmartLinterAtomicReplacer: SmartLinterAtomicReplacer
        };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
