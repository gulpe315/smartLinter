#targetengine "smartlinter_persistent_engine"

/* Creates a translated .indd without ever modifying the source document. */
(function(global) {
    'use strict';
    function hash(text) {
        var util = (typeof SmartLinterHashUtil !== 'undefined') ? SmartLinterHashUtil : global.SmartLinterHashUtil;
        if (util) return util.computeParagraphHash(text, true);
        return (new SmartLinterTextObserver()).computeHash(text, true);
    }
    function fail(request, status, message) { return { requestId: request.requestId || 'unknown', status: status, message: message }; }
    function tempFile(requestId) {
        var safe = String(requestId || 'request').replace(/[^A-Za-z0-9_-]/g, '_');
        return File(Folder.temp.fsName + '/smartlinter-' + safe + '-' + (new Date()).getTime() + '.indd');
    }
    function generate(request, options) {
        options = options || {};
        var inApp = options.appInstance || (typeof app !== 'undefined' ? app : null);
        if (!inApp || !inApp.activeDocument) return fail(request, 'FAILED', 'No active InDesign document');
        if (!request || !request.destinationPath) return fail(request || {}, 'FAILED', 'No destination path supplied');
        var sourceDoc = inApp.activeDocument, copiedDoc = null, temporary = tempFile(request.requestId), succeeded = false;
        var previousLevel = inApp.scriptPreferences ? inApp.scriptPreferences.userInteractionLevel : undefined;
        try {
            sourceDoc.saveACopy(temporary);
            copiedDoc = inApp.open(temporary);
            if (inApp.scriptPreferences && typeof UserInteractionLevels !== 'undefined') inApp.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
            var plans = (request.paragraphPlans || []).slice(0), replacer = new SmartLinterAtomicReplacer({ appInstance: inApp }), materializer = new SmartLinterInDesignTranslationMaterializer({ appInstance: inApp });
            plans.sort(function(a, b) { return a.documentOrderIndex - b.documentOrderIndex; });
            /* Verify every fingerprint before applying any hunk. */
            for (var i = 0; i < plans.length; i++) {
                var planned = replacer.findParagraphById(copiedDoc, plans[i].paragraphId, plans[i].expectedSourceHash);
                if (!planned || hash(planned.contents || '') !== plans[i].expectedSourceHash) return fail(request, 'FINGERPRINT_MISMATCH', 'Copied document paragraph fingerprint mismatch');
            }
            for (var j = 0; j < plans.length; j++) {
                var plan = plans[j], paragraph = replacer.findParagraphById(copiedDoc, plan.paragraphId, plan.expectedSourceHash);
                if (!paragraph) return fail(request, 'FINGERPRINT_MISMATCH', 'Copied document paragraph fingerprint mismatch');
                var result = materializer.apply(paragraph, plan);
                if (!result.ok) return { requestId: request.requestId || 'unknown', status: 'FAILED', message: result.diagnostic.detail || result.diagnostic.reason, diagnostic: result.diagnostic };
            }
            copiedDoc.saveAs(File(request.destinationPath));
            succeeded = true;
            if (temporary.exists) temporary.remove();
            return { requestId: request.requestId, status: 'SUCCESS', appliedParagraphCount: plans.length };
        } catch (e) {
            return fail(request, 'FAILED', String(e));
        } finally {
            if (copiedDoc && !succeeded) try { copiedDoc.close(SaveOptions.NO); } catch (closeError) {}
            try { if (temporary.exists) temporary.remove(); } catch (removeError) {}
            if (inApp.scriptPreferences) inApp.scriptPreferences.userInteractionLevel = previousLevel;
        }
    }
    global.SmartLinterDocumentGenerator = { generateTranslatedDocument: generate };
    if (typeof module !== 'undefined' && module.exports) module.exports = global.SmartLinterDocumentGenerator;
})(typeof globalThis !== 'undefined' ? globalThis : this);
