#targetengine "smartlinter_persistent_engine"

/* Applies fully rendered translation runs to a copied InDesign paragraph. */
(function(global) {
    'use strict';
    function key(face) { return face.fontFamily + '\t' + face.fontStyleName; }
    function sameFace(a, b) { return a && b && a.fontFamily === b.fontFamily && a.fontStyleName === b.fontStyleName; }
    function Materializer(options) {
        options = options || {};
        var inApp = options.appInstance || (typeof app !== 'undefined' ? app : null);
        this.fonts = {};
        var items = inApp && inApp.fonts && inApp.fonts.everyItem ? inApp.fonts.everyItem().getElements() : [];
        for (var i = 0; i < items.length; i++) {
            var font = items[i];
            if (font && font.isValid !== false && font.fontFamily && font.fontStyleName) this.fonts[String(font.fontFamily) + '\t' + String(font.fontStyleName)] = font;
        }
    }
    Materializer.prototype.fail = function(plan, reason, detail, face) {
        return { ok: false, diagnostic: { paragraphId: plan.paragraphId, documentOrderIndex: plan.documentOrderIndex, reason: reason, detail: detail, fontFamily: face && face.fontFamily, requestedStyle: face && face.fontStyleName } };
    };
    Materializer.prototype.resolve = function(plan, run) {
        var face = null, ids = run.sourceFormatIds;
        if (!ids || ids.length === 0) face = plan.inDesignDefaultFontFace;
        else {
            var map = plan.inDesignFontFaceByFormatId;
            if (!map) return null;
            for (var i = 0; i < ids.length; i++) {
                var candidate = map[ids[i]];
                if (!candidate || (face && !sameFace(face, candidate))) return null;
                face = candidate;
            }
        }
        if (!face) return null;
        var font = this.fonts[key(face)];
        return font && font.isValid !== false ? font : null;
    };
    Materializer.prototype.apply = function(paragraph, plan) {
        var runs = plan.runs;
        if (!runs || !runs.length) return this.fail(plan, 'RENDERED_TEXT_MISMATCH', 'Runs must be non-empty and join to target text');
        var joined = '', resolved = [], i, run, font;
        for (i = 0; i < runs.length; i++) joined += runs[i].text;
        if (joined !== plan.targetText) return this.fail(plan, 'RENDERED_TEXT_MISMATCH', 'Runs must be non-empty and join to target text');
        for (i = 0; i < runs.length; i++) {
            run = runs[i]; font = this.resolve(plan, run);
            if (!font) return this.fail(plan, 'FONT_FACE_UNAVAILABLE', 'Exact source Font is unavailable');
            resolved.push(font);
        }
        try {
            paragraph.contents = plan.targetText;
            var offset = 0;
            for (i = 0; i < runs.length; i++) {
                run = runs[i];
                if (run.text.length) {
                    var range = paragraph.characters.itemByRange(offset, offset + run.text.length - 1);
                    range.appliedFont = resolved[i];
                    range.underline = run.underline === true;
                }
                offset += run.text.length;
            }
            return { ok: true };
        } catch (e) { return this.fail(plan, 'FORMAT_APPLY_FAILED', String(e)); }
    };
    global.SmartLinterInDesignTranslationMaterializer = Materializer;
    if (typeof module !== 'undefined' && module.exports) module.exports = Materializer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
