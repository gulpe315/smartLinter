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

    function isParagraphLocked(paragraph) {
        var lockUtil = (typeof SmartLinterLockUtil !== 'undefined')
            ? SmartLinterLockUtil
            : (global && global.SmartLinterLockUtil);
        return !!(lockUtil && typeof lockUtil.isParagraphLocked === 'function' &&
            lockUtil.isParagraphLocked(paragraph));
    }

    /**
     * Finds a paragraph from the telemetry identifier emitted by TextObserver.
     *
     * TextObserver creates ids as `indesign-para-{storyId}-{paragraphIndex}`.
     * The paragraph index is a fast lookup hint, not a durable identity. Split
     * at the final dash so mock/custom story ids containing dashes remain safe.
     *
     * @param {Object} doc InDesign Document reference
     * @param {string} paragraphId Stable paragraph identifier
     * @param {string} [baseHash] Hash of the paragraph when the command was created
     * @returns {{story: Object, paragraphIndex: number}|null} Resolved Story and index hint, or null when unavailable
     */
    function resolveStoryForParagraphId(doc, paragraphId) {
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
        if (!doc.stories || typeof doc.stories.itemByID !== 'function') {
            return null;
        }

        // InDesign's itemByID expects a Number.  Preserve the string lookup
        // only for non-numeric/custom ids used by compatible DOM adapters.
        var numericStoryId = parseInt(storyId, 10);
        var story = isNaN(numericStoryId)
            ? doc.stories.itemByID(storyId)
            : doc.stories.itemByID(numericStoryId);
        if (!story || story.isValid === false || !story.paragraphs) {
            return null;
        }
        return { story: story, paragraphIndex: paragraphIndex };
    }

    function scanStoryForHashMatches(story, baseHash) {
        var matches = [];
        for (var i = 0; i < story.paragraphs.length; i++) {
            var paragraph = story.paragraphs[i];
            if (paragraph && paragraph.isValid !== false &&
                    getHashUtil().computeParagraphHash(paragraph.contents || '', true)
                        .toLowerCase() === baseHash.toLowerCase()) {
                matches.push(paragraph);
            }
        }
        return matches;
    }

    function findParagraphById(doc, paragraphId, baseHash) {
        try {
            var resolved = resolveStoryForParagraphId(doc, paragraphId);
            if (!resolved) {
                return null;
            }
            var story = resolved.story;
            var paragraphIndex = resolved.paragraphIndex;

            // Fast path: the stored index still identifies the original
            // paragraph. Verify the hash before accepting it, as an index can
            // point at a different paragraph after edits to the Story.
            var paragraph = null;
            if (paragraphIndex >= 0 && paragraphIndex < story.paragraphs.length) {
                paragraph = story.paragraphs[paragraphIndex];
                if (paragraph && paragraph.isValid !== false) {
                    if (!baseHash || getHashUtil().computeParagraphHash(paragraph.contents || '', true)
                            .toLowerCase() === baseHash.toLowerCase()) {
                        return paragraph;
                    }
                }
            }

            // Slow path: paragraph indices are positional, so locate the
            // original paragraph by its creation-time hash when it moved. A
            // duplicate is unsafe to choose automatically.
            if (!baseHash) {
                return null;
            }

            var matches = scanStoryForHashMatches(story, baseHash);
            return matches.length === 1 ? matches[0] : null;
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
    SmartLinterAtomicReplacer.prototype.findParagraphById = function(doc, paragraphId, baseHash) {
        return findParagraphById(doc, paragraphId, baseHash);
    };

    /**
     * Returns the current contents of a QA paragraph without changing selection or focus.
     * @param {{commandId: string, paragraphId: string, baseHash?: string}} command
     * @returns {{commandId: string, status: string, currentText?: string, currentHash?: string, message?: string}}
     */
    SmartLinterAtomicReplacer.prototype.getLiveParagraphSnapshot = function(command) {
        var commandId = command && command.commandId ? command.commandId : 'unknown';
        if (!command || typeof command.paragraphId !== 'string') {
            return { commandId: commandId, status: 'ERROR', message: 'Invalid live paragraph snapshot command' };
        }

        try {
            var inApp = this.appInstance || (typeof app !== 'undefined' ? app : null);
            var doc = inApp ? inApp.activeDocument : null;
            var resolved = resolveStoryForParagraphId(doc, command.paragraphId);
            if (!resolved) {
                return { commandId: commandId, status: 'ERROR', message: 'Unable to resolve the paragraph story.' };
            }

            var story = resolved.story;
            var paragraph = null;
            if (resolved.paragraphIndex >= 0 && resolved.paragraphIndex < story.paragraphs.length) {
                paragraph = story.paragraphs[resolved.paragraphIndex];
                if (paragraph && paragraph.isValid !== false) {
                    var currentText = this.normalizeContents(paragraph.contents);
                    return {
                        commandId: commandId,
                        status: 'FOUND',
                        currentText: currentText,
                        currentHash: getHashUtil().computeParagraphHash(currentText, true)
                    };
                }
            }

            if (!command.baseHash) {
                return { commandId: commandId, status: 'ERROR', message: 'A paragraph hash is required to search the story.' };
            }

            var matches = scanStoryForHashMatches(story, command.baseHash);
            if (matches.length === 0) {
                return { commandId: commandId, status: 'NOT_FOUND', message: 'The paragraph could not be found in the story.' };
            }
            if (matches.length > 1) {
                return { commandId: commandId, status: 'AMBIGUOUS', message: 'Multiple paragraphs match the stored paragraph hash.' };
            }

            var matchedText = this.normalizeContents(matches[0].contents);
            return {
                commandId: commandId,
                status: 'FOUND',
                currentText: matchedText,
                currentHash: getHashUtil().computeParagraphHash(matchedText, true)
            };
        } catch (e) {
            return { commandId: commandId, status: 'ERROR', message: e.message };
        }
    };

    /**
     * Returns current contents for multiple QA paragraphs without changing selection or focus.
     * @param {{commandId: string, paragraphIds: string[]}} command
     * @returns {{commandId: string, results: Array}}
     */
    SmartLinterAtomicReplacer.prototype.getLiveParagraphSnapshots = function(command) {
        var commandId = command && command.commandId ? command.commandId : 'unknown';
        if (!command || !command.paragraphIds || typeof command.paragraphIds.length !== 'number') {
            return { commandId: commandId, results: [] };
        }

        var results = [];
        for (var i = 0; i < command.paragraphIds.length; i++) {
            var paragraphId = command.paragraphIds[i];
            try {
                var inApp = this.appInstance || (typeof app !== 'undefined' ? app : null);
                var doc = inApp ? inApp.activeDocument : null;
                var resolved = resolveStoryForParagraphId(doc, paragraphId);
                if (!resolved) {
                    results.push({ paragraphId: paragraphId, status: 'ERROR', message: 'Unable to resolve the paragraph story.' });
                    continue;
                }

                var story = resolved.story;
                if (resolved.paragraphIndex < 0 || resolved.paragraphIndex >= story.paragraphs.length) {
                    results.push({ paragraphId: paragraphId, status: 'NOT_FOUND', message: 'The paragraph index is outside the story.' });
                    continue;
                }

                var paragraph = story.paragraphs[resolved.paragraphIndex];
                if (!paragraph || paragraph.isValid === false) {
                    results.push({ paragraphId: paragraphId, status: 'NOT_FOUND', message: 'The paragraph is no longer available.' });
                    continue;
                }

                var currentText = this.normalizeContents(paragraph.contents);
                results.push({
                    paragraphId: paragraphId,
                    status: 'FOUND',
                    currentText: currentText,
                    currentHash: getHashUtil().computeParagraphHash(currentText, true)
                });
            } catch (e) {
                results.push({ paragraphId: paragraphId, status: 'ERROR', message: e.message });
            }
        }

        return { commandId: commandId, results: results };
    };

    /**
     * Locates and selects a QA paragraph without changing document contents.
     * @param {{commandId: string, paragraphId: string, baseHash?: string, startOffset?: number, endOffset?: number}} command
     * @param {Object} [options]
     * @returns {{commandId: string, status: 'FOUND'|'NOT_FOUND'|'AMBIGUOUS'|'SELECTION_FAILED'|'ERROR', message: string}}
     */
    SmartLinterAtomicReplacer.prototype.locateParagraph = function(command, options) {
        options = options || {};
        var commandId = command && command.commandId ? command.commandId : 'unknown';
        if (!command || typeof command.paragraphId !== 'string') {
            return { commandId: commandId, status: 'ERROR', message: 'Invalid paragraph location command' };
        }

        var inApp = options.appInstance || this.appInstance || (typeof app !== 'undefined' ? app : null);
        var doc;
        var paragraph;
        try {
            doc = inApp ? inApp.activeDocument : null;
            var resolved = resolveStoryForParagraphId(doc, command.paragraphId);
            if (!resolved) {
                return { commandId: commandId, status: 'ERROR', message: 'Unable to resolve the paragraph story.' };
            }

            var story = resolved.story;
            if (resolved.paragraphIndex >= 0 && resolved.paragraphIndex < story.paragraphs.length) {
                paragraph = story.paragraphs[resolved.paragraphIndex];
                if (paragraph && paragraph.isValid !== false &&
                        (!command.baseHash || getHashUtil().computeParagraphHash(paragraph.contents || '', true)
                            .toLowerCase() === command.baseHash.toLowerCase())) {
                    return selectLocatedParagraph(inApp, doc, paragraph, commandId, command.startOffset, command.endOffset);
                }
            }

            if (!command.baseHash) {
                return { commandId: commandId, status: 'ERROR', message: 'A paragraph hash is required to search the story.' };
            }

            var matches = scanStoryForHashMatches(story, command.baseHash);
            if (matches.length === 0) {
                return { commandId: commandId, status: 'NOT_FOUND', message: 'The paragraph could not be found in the story.' };
            }
            if (matches.length > 1) {
                return { commandId: commandId, status: 'AMBIGUOUS', message: 'Multiple paragraphs match the stored paragraph hash.' };
            }
            return selectLocatedParagraph(inApp, doc, matches[0], commandId, command.startOffset, command.endOffset);
        } catch (e) {
            return { commandId: commandId, status: 'ERROR', message: 'Unable to resolve the paragraph location: ' + e.message };
        }
    };

    function getCharacterRange(paragraph, start, end) {
        if (!paragraph || !paragraph.characters || typeof paragraph.characters.itemByRange !== 'function') {
            throw new Error('InDesign character range API is unavailable');
        }

        // InDesign itemByRange is 0-based inclusive for both start and end.
        var charRange = paragraph.characters.itemByRange(start, end - 1);
        if (!charRange || charRange.isValid === false) {
            throw new Error('InDesign character range is invalid');
        }
        return charRange;
    }

    function selectLocatedParagraph(inApp, doc, paragraph, commandId, startOffset, endOffset) {
        try {
            // Make the owning document/window active before selecting its text range.
            if (doc.windows && doc.windows.length > 0 && typeof doc.windows[0].activate === 'function') {
                doc.windows[0].activate();
            }
            if (!inApp || typeof inApp.select !== 'function') {
                throw new Error('InDesign selection API is unavailable');
            }

            var hasStartOffset = typeof startOffset !== 'undefined' && startOffset !== null;
            var hasEndOffset = typeof endOffset !== 'undefined' && endOffset !== null;
            if (!hasStartOffset && !hasEndOffset) {
                inApp.select(paragraph.texts && paragraph.texts.length > 0 ? paragraph.texts[0] : paragraph);
                return { commandId: commandId, status: 'FOUND', message: 'Paragraph selected in InDesign' };
            }

            var paragraphText = paragraph.contents || '';
            if (typeof paragraphText !== 'string') {
                paragraphText = String(paragraphText);
            }
            if (!hasStartOffset || !hasEndOffset || typeof startOffset !== 'number' || typeof endOffset !== 'number' ||
                    startOffset < 0 || startOffset >= endOffset || endOffset > paragraphText.length) {
                throw new Error('Invalid character selection range [' + startOffset + ':' + endOffset + '] for paragraph length ' + paragraphText.length);
            }

            inApp.select(getCharacterRange(paragraph, startOffset, endOffset));
            return { commandId: commandId, status: 'FOUND', message: 'Text span selected in InDesign' };
        } catch (e) {
            return { commandId: commandId, status: 'SELECTION_FAILED', message: 'Unable to select the located paragraph: ' + e.message };
        }
    }

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
            var charRange = getCharacterRange(paragraph, start, end);
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
            var doc = options.doc || (inApp ? inApp.activeDocument : null);
            targetParagraph = findParagraphById(doc, command.paragraphId, command.baseHash);
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

        // InDesign permits scripted Story/Text mutations even when the owning
        // frame or layer is locked. Respect that authoring lock before a
        // transaction is opened; locateParagraph intentionally remains usable.
        if (targetParagraph && isParagraphLocked(targetParagraph)) {
            var lockedResult = {
                commandId: command.commandId,
                status: 'FAILED',
                currentHash: '',
                message: '\uD574\uB2F9 \uD14D\uC2A4\uD2B8 \uD504\uB808\uC784 \uB610\uB294 \uB808\uC774\uC5B4\uAC00 \uC7A0\uACA8 \uC788\uC5B4 \uC218\uC815\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. InDesign\uC5D0\uC11C \uC7A0\uAE08\uC744 \uD574\uC81C\uD55C \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.'
            };
            this.dispatchResultIfNeeded(lockedResult, options);
            return lockedResult;
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
