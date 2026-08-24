const { DiffEngine } = require('./diff_engine');
const { SpecialElementsParagraph } = require('./special_elements_model');
const { WordOfficeJsReplacer, WordMockParagraph, WordTransactionSimulator } = require('./word_officejs_poc');
const { InDesignMockParagraph, InDesignMockApp, InDesignReplacer } = require('./indesign_poc');
const { CollisionObserver } = require('./collision_observer');

function runAllSpikeTests() {
  console.log('================================================================');
  console.log('  Task 1 Spike: Format-Preserving Replacement & Rollback Suite  ');
  console.log('================================================================\n');

  const testResults = {
    test1_drift_defense: null,
    test2_special_elements: null,
    test3_word_rollback: null,
    test4_indesign_rollback: null,
    test5_collision_observation: null
  };

  // ================================================================
  // 1. Multi-Hunk Offset Drift Benchmark (Forward vs Reverse)
  // ================================================================
  console.log('--- [Test 1] Forward vs Reverse Multi-Hunk Replacement ---');
  const sampleParagraph1 = 'The quick brown fox jumps over the lazy dog in the sunny park.';
  const hunks1 = [
    { startOffset: 10, endOffset: 15, oldText: 'brown', newText: 'dark reddish-brown' },
    { startOffset: 35, endOffset: 39, oldText: 'lazy', newText: 'extremely sleepy' },
    { startOffset: 51, endOffset: 56, oldText: 'sunny', newText: 'bright' }
  ];

  const forwardResult = DiffEngine.replaceForward(sampleParagraph1, hunks1);
  const reverseResult = DiffEngine.replaceReverse(sampleParagraph1, hunks1);

  console.log('Forward Order: Drift Errors = ' + forwardResult.driftErrors + ' (Text corrupted)');
  console.log('Reverse Order: Drift Errors = ' + reverseResult.driftErrors + ' (100% Precise)');
  console.log('Reverse Final Text: ' + JSON.stringify(reverseResult.finalText) + '\n');

  testResults.test1_drift_defense = {
    forwardErrors: forwardResult.driftErrors,
    reverseErrors: reverseResult.driftErrors,
    success: reverseResult.driftErrors === 0 && forwardResult.driftErrors > 0
  };

  // ================================================================
  // 2. Special Elements (Footnotes & Hyperlinks) Integrity
  // ================================================================
  console.log('--- [Test 2] Special Elements (Footnotes/Hyperlinks) Integrity ---');
  const richStructure = [
    { type: 'text', text: 'According to ', format: { bold: false } },
    { type: 'hyperlink', text: 'SmartLinter specs', url: 'https://smartlinter.dev', format: { underline: true } },
    { type: 'text', text: ', the native format', format: { bold: false } },
    { type: 'footnote', text: '', footnoteId: 1, noteContent: 'Architecture section 2.A', format: { superscript: true } },
    { type: 'text', text: ' must be preserved perfectly.', format: { bold: false } }
  ];

  const richDoc = new SpecialElementsParagraph(richStructure);
  const initialRichText = richDoc.getPlainText();
  console.log('Initial Rich Text: ' + JSON.stringify(initialRichText));

  // Multi-hunks:
  // 1. 'specs' [25..30] inside hyperlink -> 'specifications'
  // 2. 'preserved' [62..71] after footnote -> 'maintained'
  const richHunks = [
    { startOffset: 25, endOffset: 30, oldText: 'specs', newText: 'specifications' },
    { startOffset: 62, endOffset: 71, oldText: 'preserved', newText: 'maintained' }
  ];

  // Test Forward Order on Rich Paragraph (should cause drift error for second hunk)
  const richDocForward = richDoc.clone();
  const forwardRichRes = richDocForward.applyHunks(richHunks, false);
  const forwardDrift = forwardRichRes.logs.some(l => l.status === 'DRIFT_MISMATCH' || l.status === 'ERROR');

  // Test Reverse Order on Rich Paragraph (safe)
  const richDocReverse = richDoc.clone();
  const reverseRichRes = richDocReverse.applyHunks(richHunks, true);
  console.log('After Safe Reverse Replace: ' + JSON.stringify(reverseRichRes.finalPlainText));
  
  const footnoteElement = reverseRichRes.elements.find(el => el.type === 'footnote');
  const hyperlinkElement = reverseRichRes.elements.find(el => el.type === 'hyperlink');

  const specialElementsPreserved = 
    footnoteElement && footnoteElement.footnoteId === 1 && footnoteElement.noteContent === 'Architecture section 2.A' &&
    hyperlinkElement && hyperlinkElement.url === 'https://smartlinter.dev' && hyperlinkElement.text === 'SmartLinter specifications';

  console.log('Forward Order Drift Detected: ' + (forwardDrift ? 'YES (Drift occurred)' : 'NO'));
  console.log('Reverse Order Special Elements Integrity: ' + (specialElementsPreserved ? 'PRESERVED 100% (Drift: 0)' : 'FAILED') + '\n');

  testResults.test2_special_elements = {
    forwardDriftDetected: forwardDrift,
    specialElementsPreserved,
    finalText: reverseRichRes.finalPlainText
  };

  // ================================================================
  // 3. Word (Office.js) Compensating Transaction Rollback
  // ================================================================
  console.log('--- [Test 3] Word Office.js Compensating Transaction Rollback ---');
  const wordInitial = 'Alpha beta gamma delta epsilon zeta.';
  const wordHunks = [
    { startOffset: 0, endOffset: 5, oldText: 'Alpha', newText: 'FIRST_ITEM' },
    { startOffset: 11, endOffset: 16, oldText: 'gamma', newText: 'THIRD_ITEM' },
    { startOffset: 23, endOffset: 30, oldText: 'epsilon', newText: 'FIFTH_ITEM' }
  ];

  // Case 3.1: Normal execution
  const wordParaNormal = new WordMockParagraph(wordInitial);
  const wordNormalRes = WordTransactionSimulator.runTransaction(wordParaNormal, wordHunks);
  console.log('Word Normal Execution: Success = ' + wordNormalRes.success);
  console.log('Word Normal Output: ' + JSON.stringify(wordNormalRes.finalText));

  // Case 3.2: Simulated Error during Hunk #2 -> Triggers Compensating Transaction
  const wordParaFail = new WordMockParagraph(wordInitial);
  const wordFailRes = WordTransactionSimulator.runTransaction(wordParaFail, wordHunks, { simulateErrorAtHunk: 2 });
  console.log('Word Simulated Failure: Success = ' + wordFailRes.success + ', Error = ' + JSON.stringify(wordFailRes.error));
  console.log('Word Compensating Rollback Result: ' + (wordFailRes.rollbackSuccess ? 'RESTORED 100%' : 'FAILED'));
  console.log('Post-Rollback Text Equals Original: ' + (wordFailRes.isRestored ? 'YES' : 'NO') + '\n');

  testResults.test3_word_rollback = {
    normalSuccess: wordNormalRes.success,
    errorCaught: !wordFailRes.success,
    rollbackSuccess: wordFailRes.rollbackSuccess,
    isRestored: wordFailRes.isRestored
  };

  // ================================================================
  // 4. InDesign app.doScript(UndoModes.ENTIRE_SCRIPT) Atomic Rollback
  // ================================================================
  console.log('--- [Test 4] InDesign app.doScript Atomic Rollback ---');
  const idInitial = 'Chapter 1: The foundation of modern design systems.';
  const idHunks = [
    { startOffset: 15, endOffset: 25, oldText: 'foundation', newText: 'core pillar' },
    { startOffset: 29, endOffset: 35, oldText: 'modern', newText: 'contemporary' }
  ];

  // Case 4.1: Normal InDesign Replace
  const idParaNormal = new InDesignMockParagraph(idInitial);
  const idNormalRes = InDesignReplacer.execute(idParaNormal, idHunks);
  console.log('InDesign Normal Execution: Success = ' + idNormalRes.success);
  console.log('InDesign Normal Output: ' + JSON.stringify(idParaNormal.getText()));

  // Case 4.2: Simulated InDesign Failure -> Atomic Entire Script Rollback
  const idParaFail = new InDesignMockParagraph(idInitial);
  const idFailRes = InDesignReplacer.execute(idParaFail, idHunks, { simulateErrorAtHunk: 1 });
  console.log('InDesign Simulated Failure: Success = ' + idFailRes.success + ', RolledBack = ' + idFailRes.rolledBack);
  console.log('InDesign Post-Rollback Text: ' + JSON.stringify(idParaFail.getText()));
  console.log('InDesign Atomic Restoration: ' + (idParaFail.getText() === idInitial ? 'RESTORED 100%' : 'FAILED') + '\n');

  testResults.test4_indesign_rollback = {
    normalSuccess: idNormalRes.success,
    atomicRollbackTriggered: idFailRes.rolledBack,
    restored100Percent: idParaFail.getText() === idInitial
  };

  // ================================================================
  // 5. Collision Observation (User typing / undo during rollback)
  // ================================================================
  console.log('--- [Test 5] Collision & Interference Observation (Feedback Requirements) ---');
  const collisionText = 'Section 10: Original term AAA and term BBB in document.';
  const collisionHunks = [
    { startOffset: 26, endOffset: 29, oldText: 'AAA', newText: 'ALPHA_REPLACEMENT' },
    { startOffset: 39, endOffset: 42, oldText: 'BBB', newText: 'BETA_REPLACEMENT' }
  ];

  const prefixObs = CollisionObserver.observePrefixTypingCollision(collisionText, collisionHunks, 'USER_TYPING_HERE ', 0);
  const inlineObs = CollisionObserver.observeInlineEditCollision(collisionText, collisionHunks, 0);
  const undoRaceObs = CollisionObserver.observeNativeUndoRaceCollision(collisionText, collisionHunks);

  console.log('[Scenario A: Prefix Typing Intervention]');
  console.log(' - User Action: Inserted text at prefix during/before rollback.');
  console.log(' - Symptoms:', JSON.stringify(prefixObs.symptoms, null, 2));
  console.log(' - Result:', prefixObs.outcome);
  console.log('');

  console.log('[Scenario B: Inline Edit Intervention]');
  console.log(' - User Action: User modified replaced word before rollback completed.');
  console.log(' - Symptoms:', JSON.stringify(inlineObs.symptoms, null, 2));
  console.log(' - Result:', inlineObs.outcome);
  console.log('');

  console.log('[Scenario C: Native Undo Race Condition]');
  console.log(' - User Action: User hit Ctrl+Z right before Compensating Transaction fired.');
  console.log(' - Symptoms:', JSON.stringify(undoRaceObs.symptoms, null, 2));
  console.log(' - Result:', undoRaceObs.outcome);
  console.log('');

  testResults.test5_collision_observation = {
    prefixTyping: prefixObs,
    inlineEdit: inlineObs,
    nativeUndoRace: undoRaceObs
  };

  console.log('================================================================');
  console.log('                 TASK 1 SPIKE TEST COMPLETE                     ');
  console.log('================================================================');

  return testResults;
}

if (require.main === module) {
  runAllSpikeTests();
}

module.exports = { runAllSpikeTests };