#targetengine "smartlinter_persistent_engine"

/**
 * SmartLinter InDesign ExtendScript Transaction Runner
 * 
 * Executes DOM operations within InDesign's native atomic undo transaction:
 * `app.doScript(callback, ScriptLanguage.JAVASCRIPT, args, UndoModes.ENTIRE_SCRIPT, undoName)`
 * 
 * If an unhandled exception is thrown inside `doScript`, InDesign's native undo engine
 * automatically rolls back all DOM modifications made during that script execution,
 * leaving the document in its exact pre-execution state.
 */

(function(global) {
    'use strict';

    /**
     * UndoModes constants fallback for non-InDesign or mock environments
     */
    var UndoModesEnum = (typeof UndoModes !== 'undefined') ? UndoModes : {
        ENTIRE_SCRIPT: 'ENTIRE_SCRIPT',
        FAST_ENTIRE_SCRIPT: 'FAST_ENTIRE_SCRIPT',
        AUTO_UNDO: 'AUTO_UNDO',
        SCRIPT_REQUEST: 'SCRIPT_REQUEST'
    };

    var ScriptLanguageEnum = (typeof ScriptLanguage !== 'undefined') ? ScriptLanguage : {
        JAVASCRIPT: 'JAVASCRIPT'
    };

    /**
     * SmartLinterTransactionRunner constructor
     * @param {Object} [config]
     */
    function SmartLinterTransactionRunner(config) {
        config = config || {};
        this.appInstance = config.appInstance || (typeof app !== 'undefined' ? app : null);
        this.defaultUndoMode = config.undoMode || UndoModesEnum.ENTIRE_SCRIPT;
        this.defaultUndoName = config.undoName || 'SmartLinter Multi-Hunk Replace';
    }

    /**
     * Checks whether an undoMode corresponds to an atomic rollback mode
     * @param {any} mode
     * @returns {boolean}
     */
    SmartLinterTransactionRunner.prototype.isAtomicMode = function(mode) {
        if (!mode) return false;
        if (mode === UndoModesEnum.ENTIRE_SCRIPT || mode === UndoModesEnum.FAST_ENTIRE_SCRIPT) {
            return true;
        }
        if (mode === 'ENTIRE_SCRIPT' || mode === 'FAST_ENTIRE_SCRIPT') {
            return true;
        }
        if (typeof UndoModes !== 'undefined') {
            if (mode === UndoModes.ENTIRE_SCRIPT || mode === UndoModes.FAST_ENTIRE_SCRIPT) {
                return true;
            }
        }
        return false;
    };

    /**
     * Executes a callback within app.doScript with UndoModes.ENTIRE_SCRIPT
     * 
     * @param {Function} callback Function to execute within atomic undo transaction
     * @param {Object} [options] Execution options
     * @param {Object} [options.appInstance] InDesign application reference
     * @param {any} [options.undoMode] Default UndoModes.ENTIRE_SCRIPT
     * @param {string} [options.undoName] Default 'SmartLinter Multi-Hunk Replace'
     * @param {Array} [options.args] Arguments to pass to callback
     * @returns {{ success: boolean, result?: any, error?: string, rolledBack: boolean, undoName: string, undoMode: any }}
     */
    SmartLinterTransactionRunner.prototype.runInTransaction = function(callback, options) {
        options = options || {};
        var inApp = options.appInstance || this.appInstance || (typeof app !== 'undefined' ? app : null);
        var undoMode = options.undoMode || this.defaultUndoMode;
        var undoName = options.undoName || this.defaultUndoName;
        var args = options.args || [];

        if (typeof callback !== 'function') {
            return {
                success: false,
                error: 'Transaction callback must be a function',
                rolledBack: false,
                undoName: undoName,
                undoMode: undoMode
            };
        }

        // Native InDesign app.doScript execution
        if (inApp && typeof inApp.doScript === 'function') {
            var executionResult = null;
            var scriptLang = (typeof ScriptLanguage !== 'undefined' && ScriptLanguage.JAVASCRIPT)
                ? ScriptLanguage.JAVASCRIPT
                : ScriptLanguageEnum.JAVASCRIPT;

            try {
                // app.doScript(script, language, args, undoMode, undoName)
                inApp.doScript(
                    function() {
                        executionResult = callback.apply(null, args);
                    },
                    scriptLang,
                    args,
                    undoMode,
                    undoName
                );

                return {
                    success: true,
                    result: executionResult,
                    rolledBack: false,
                    undoName: undoName,
                    undoMode: undoMode
                };
            } catch (err) {
                // When an error is caught outside doScript with ENTIRE_SCRIPT,
                // InDesign has already automatically discarded all changes inside doScript.
                var errMsg = (err && err.message) ? err.message : String(err);
                var wasRolledBack = this.isAtomicMode(undoMode);

                return {
                    success: false,
                    error: errMsg,
                    rolledBack: wasRolledBack,
                    undoName: undoName,
                    undoMode: undoMode
                };
            }
        }

        // Fallback execution when app.doScript is not available
        try {
            var res = callback.apply(null, args);
            return {
                success: true,
                result: res,
                rolledBack: false,
                undoName: undoName,
                undoMode: undoMode
            };
        } catch (err2) {
            return {
                success: false,
                error: (err2 && err2.message) ? err2.message : String(err2),
                rolledBack: false,
                undoName: undoName,
                undoMode: undoMode
            };
        }
    };

    // Register globally in ExtendScript
    if (typeof $ !== 'undefined' && $.global) {
        $.global.SmartLinterTransactionRunner = SmartLinterTransactionRunner;
        $.global.SmartLinterUndoModes = UndoModesEnum;
    } else if (typeof global !== 'undefined') {
        global.SmartLinterTransactionRunner = SmartLinterTransactionRunner;
        global.SmartLinterUndoModes = UndoModesEnum;
    }

    // CommonJS export for Node.js / unit tests
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            SmartLinterTransactionRunner: SmartLinterTransactionRunner,
            UndoModesEnum: UndoModesEnum,
            ScriptLanguageEnum: ScriptLanguageEnum
        };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
