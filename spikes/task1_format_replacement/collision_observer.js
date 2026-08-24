/**
 * Collision & User Intervention Observer (Task 1 Special Spike)
 */

class CollisionObserver {
  static observePrefixTypingCollision(originalText, hunks, userInsertedText, insertOffset = 0) {
    const log = {
      scenario: 'Prefix Typing During Rollback',
      initialText: originalText,
      userInsertion: { text: userInsertedText, offset: insertOffset },
      symptoms: [],
      outcome: ''
    };

    const sortedHunks = [...hunks].sort((a, b) => b.startOffset - a.startOffset);
    let currentText = originalText;
    const journal = [];

    for (let i = 0; i < sortedHunks.length; i++) {
      const hunk = sortedHunks[i];
      currentText = currentText.substring(0, hunk.startOffset) + hunk.newText + currentText.substring(hunk.endOffset);
      journal.push({
        hunkIndex: i,
        startOffset: hunk.startOffset,
        endOffset: hunk.startOffset + hunk.newText.length,
        originalText: hunk.oldText,
        newText: hunk.newText
      });
    }

    log.textAfterReplace = currentText;

    // User typing intervention
    currentText = currentText.substring(0, insertOffset) + userInsertedText + currentText.substring(insertOffset);
    log.textAfterUserTyping = currentText;

    // Rollback attempt using stored offsets
    const reversedJournal = [...journal].reverse();
    let textWithOffsetRollback = currentText;
    let offsetRollbackFailed = false;

    for (const entry of reversedJournal) {
      const targetSlice = textWithOffsetRollback.substring(entry.startOffset, entry.endOffset);
      if (targetSlice !== entry.newText) {
        offsetRollbackFailed = true;
        log.symptoms.push({
          type: 'OFFSET_CORRUPTION_OR_MISMATCH',
          expectedAtStoredOffset: entry.newText,
          foundAtStoredOffset: targetSlice,
          storedRange: [entry.startOffset, entry.endOffset],
          description: 'Offset shifted by ' + userInsertedText.length + ' chars. Replacing at stale offset caused wrong text corruption.'
        });
      }
      textWithOffsetRollback = textWithOffsetRollback.substring(0, entry.startOffset) + entry.originalText + textWithOffsetRollback.substring(entry.endOffset);
    }

    log.textAfterNaiveOffsetRollback = textWithOffsetRollback;

    // Search-based rollback
    let textWithSearchRollback = currentText;
    for (const entry of reversedJournal) {
      const searchIndex = textWithSearchRollback.lastIndexOf(entry.newText);
      if (searchIndex === -1) {
        log.symptoms.push({
          type: 'SEARCH_TARGET_NOT_FOUND',
          target: entry.newText,
          description: 'Could not find ' + JSON.stringify(entry.newText) + ' in modified document during rollback.'
        });
      } else {
        textWithSearchRollback = textWithSearchRollback.substring(0, searchIndex) + entry.originalText + textWithSearchRollback.substring(searchIndex + entry.newText.length);
      }
    }

    log.textAfterSearchRollback = textWithSearchRollback;
    log.outcome = offsetRollbackFailed 
      ? 'FAILURE: Naive offset rollback causes silent text corruption. Search-based rollback succeeds only if substituted tokens remain unique and unedited.'
      : 'SUCCESS: No collision detected.';

    return log;
  }

  static observeInlineEditCollision(originalText, hunks, editHunkIndex = 0) {
    const log = {
      scenario: 'Inline User Edit on Substituted Text',
      initialText: originalText,
      symptoms: [],
      outcome: ''
    };

    const sortedHunks = [...hunks].sort((a, b) => b.startOffset - a.startOffset);
    let currentText = originalText;
    const journal = [];

    for (let i = 0; i < sortedHunks.length; i++) {
      const hunk = sortedHunks[i];
      currentText = currentText.substring(0, hunk.startOffset) + hunk.newText + currentText.substring(hunk.endOffset);
      journal.push({
        hunkIndex: i,
        startOffset: hunk.startOffset,
        endOffset: hunk.startOffset + hunk.newText.length,
        originalText: hunk.oldText,
        newText: hunk.newText
      });
    }

    log.textAfterReplace = currentText;

    const targetHunk = journal[editHunkIndex];
    const userModifiedText = targetHunk.newText.substring(0, 2) + '_USER_EDIT_';
    currentText = currentText.replace(targetHunk.newText, userModifiedText);
    log.textAfterUserEdit = currentText;

    const reversedJournal = [...journal].reverse();
    let rollbackSuccess = true;

    for (const entry of reversedJournal) {
      if (!currentText.includes(entry.newText)) {
        rollbackSuccess = false;
        log.symptoms.push({
          type: 'TARGET_DESTROYED_BY_USER',
          expectedTarget: entry.newText,
          description: 'User manually modified or deleted ' + JSON.stringify(entry.newText) + ', making automated reverse substitution impossible.'
        });
      } else {
        currentText = currentText.replace(entry.newText, entry.originalText);
      }
    }

    log.finalTextAfterCompensatingRollback = currentText;
    log.outcome = rollbackSuccess
      ? 'SUCCESS'
      : 'PARTIAL_FAILURE (Zombie State): Document left in mixed state where unedited hunks are reverted, but user-edited hunk remains broken.';

    return log;
  }

  static observeNativeUndoRaceCollision(originalText, hunks) {
    const log = {
      scenario: 'Native Ctrl+Z Undo vs Compensating Transaction Race',
      initialText: originalText,
      symptoms: [],
      outcome: ''
    };

    const sortedHunks = [...hunks].sort((a, b) => b.startOffset - a.startOffset);
    let currentText = originalText;
    const journal = [];

    for (let i = 0; i < sortedHunks.length; i++) {
      const hunk = sortedHunks[i];
      currentText = currentText.substring(0, hunk.startOffset) + hunk.newText + currentText.substring(hunk.endOffset);
      journal.push({
        hunkIndex: i,
        originalText: hunk.oldText,
        newText: hunk.newText
      });
    }

    log.textAfterReplace = currentText;

    // User hits Ctrl+Z
    currentText = originalText;
    log.textAfterUserUndo = currentText;

    const reversedJournal = [...journal].reverse();
    for (const entry of reversedJournal) {
      if (!currentText.includes(entry.newText)) {
        log.symptoms.push({
          type: 'REDUNDANT_ROLLBACK_ON_REVERTED_DOC',
          soughtToken: entry.newText,
          description: 'Document was already reverted by native Undo. Compensating transaction looked for ' + JSON.stringify(entry.newText) + ' and found nothing.'
        });
      } else {
        currentText = currentText.replace(entry.newText, entry.originalText);
      }
    }

    log.finalText = currentText;
    log.outcome = 'BENIGN_NOOP_OR_MISFIRE: If search-based, it turns into a harmless no-op. If offset-based without validation, it corrupts original text.';

    return log;
  }
}

module.exports = { CollisionObserver };