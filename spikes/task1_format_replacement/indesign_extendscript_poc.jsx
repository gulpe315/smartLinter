#target indesign

/**
 * SmartLinter InDesign Multi-Hunk Replacement PoC (ExtendScript / UXP)
 * 
 * Demonstrates:
 * 1. Multi-Hunk reverse-order text replacement across TextStyleRanges/Characters.
 * 2. Atomic rollback using app.doScript with UndoModes.ENTIRE_SCRIPT.
 */

(function main() {
    if (app.documents.length === 0) {
        alert('Please open an InDesign document first.');
        return;
    }

    var doc = app.activeDocument;
    var sel = app.selection;

    if (sel.length === 0 || !(sel[0].hasOwnProperty('paragraphs'))) {
        alert('Please select a text frame or paragraph.');
        return;
    }

    var targetParagraph = sel[0].paragraphs[0];

    // Sample Hunks (Offset-based)
    var sampleHunks = [
        { startOffset: 5, endOffset: 12, oldText: 'ancient', newText: 'modern' },
        { startOffset: 25, endOffset: 31, oldText: 'engine', newText: 'architecture' }
    ];

    var shouldSimulateError = false; // Set to true to test atomic rollback

    // Execute within native atomic undo transaction
    try {
        app.doScript(
            function() {
                executeInDesignMultiHunkReplace(targetParagraph, sampleHunks, shouldSimulateError);
            },
            ScriptLanguage.JAVASCRIPT,
            [],
            UndoModes.ENTIRE_SCRIPT,
            'SmartLinter Multi-Hunk Replace'
        );
        alert('SmartLinter replacement completed successfully.');
    } catch (e) {
        // When an exception is thrown inside doScript with ENTIRE_SCRIPT,
        // InDesign automatically discards all modifications made inside the script.
        alert('SmartLinter atomic rollback triggered! Error: ' + e.message);
    }
})();

function executeInDesignMultiHunkReplace(paragraph, hunks, simulateError) {
    // 1. Sort hunks in REVERSE order (descending startOffset) to prevent offset drift
    var sortedHunks = hunks.slice(0).sort(function(a, b) {
        return b.startOffset - a.startOffset;
    });

    for (var i = 0; i < sortedHunks.length; i++) {
        var hunk = sortedHunks[i];

        if (simulateError && i === sortedHunks.length - 1) {
            throw new Error('Simulated InDesign DOM error at hunk #' + i);
        }

        // InDesign 0-based character indexing
        var charRange = paragraph.characters.itemByRange(hunk.startOffset, hunk.endOffset - 1);
        
        // Verify current contents before replacing
        var currentText = charRange.contents;
        if (currentText !== hunk.oldText) {
            throw new Error('Offset mismatch: expected "' + hunk.oldText + '", found "' + currentText + '"');
        }

        // Replace content directly on native Range (preserves paragraph/character styles)
        charRange.contents = hunk.newText;
    }
}
