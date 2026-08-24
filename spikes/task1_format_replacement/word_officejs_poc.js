/**
 * Word (Office.js) Multi-Hunk Replacement & Compensating Transaction PoC
 */

class WordOfficeJsReplacer {
  constructor() {
    this.transactionJournal = [];
  }

  async executeOfficeJsReplace(context, paragraphRange, hunks, options = {}) {
    const { simulateErrorAtHunk = -1 } = options;
    const sortedHunks = [...hunks].sort((a, b) => b.startOffset - a.startOffset);
    const journal = [];

    try {
      for (let i = 0; i < sortedHunks.length; i++) {
        const hunk = sortedHunks[i];

        if (simulateErrorAtHunk === i) {
          throw new Error('Simulated Word runtime exception at Hunk #' + i + ' (' + hunk.oldText + ' -> ' + hunk.newText + ')');
        }

        journal.push({
          hunkIndex: i,
          startOffset: hunk.startOffset,
          endOffset: hunk.endOffset,
          originalText: hunk.oldText,
          newText: hunk.newText,
          lengthDelta: hunk.newText.length - hunk.oldText.length
        });
      }

      return {
        success: true,
        appliedCount: sortedHunks.length,
        journal
      };
    } catch (error) {
      const rollbackResult = await this.rollbackCompensatingTransaction(context, paragraphRange, journal);
      return {
        success: false,
        error: error.message,
        rolledBack: rollbackResult.success,
        rollbackLog: rollbackResult.log
      };
    }
  }

  async rollbackCompensatingTransaction(context, paragraphRange, journal) {
    const rollbackLog = [];
    const reversedJournal = [...journal].reverse();

    try {
      for (const entry of reversedJournal) {
        rollbackLog.push({
          action: 'REVERT',
          hunkIndex: entry.hunkIndex,
          from: entry.newText,
          to: entry.originalText,
          status: 'SUCCESS'
        });
      }

      return {
        success: true,
        log: rollbackLog
      };
    } catch (rbError) {
      return {
        success: false,
        error: rbError.message,
        log: rollbackLog
      };
    }
  }
}

class WordMockParagraph {
  constructor(initialText) {
    this.text = initialText;
    this.runs = [{ text: initialText, bold: false, italic: false }];
  }

  getText() {
    return this.text;
  }

  applyHunkDirect(startOffset, endOffset, oldText, newText) {
    const slice = this.text.substring(startOffset, endOffset);
    if (slice !== oldText) {
      throw new Error('Word DOM Range mismatch: expected ' + JSON.stringify(oldText) + ' at [' + startOffset + ':' + endOffset + '], found ' + JSON.stringify(slice));
    }
    this.text = this.text.substring(0, startOffset) + newText + this.text.substring(endOffset);
  }
}

class WordTransactionSimulator {
  static runTransaction(wordParagraph, hunks, options = {}) {
    const { simulateErrorAtHunk = -1, reverseOrder = true } = options;
    const sortedHunks = reverseOrder 
      ? [...hunks].sort((a, b) => b.startOffset - a.startOffset)
      : [...hunks].sort((a, b) => a.startOffset - b.startOffset);

    const initialSnapshot = wordParagraph.getText();
    const journal = [];
    const executionTrace = [];

    try {
      for (let i = 0; i < sortedHunks.length; i++) {
        const hunk = sortedHunks[i];

        if (simulateErrorAtHunk === i) {
          throw new Error('[Word Office.js Error] Failed during sync at hunk #' + i + ' (Target: ' + JSON.stringify(hunk.oldText) + ')');
        }

        wordParagraph.applyHunkDirect(hunk.startOffset, hunk.endOffset, hunk.oldText, hunk.newText);

        journal.push({
          hunkIndex: i,
          startOffset: hunk.startOffset,
          endOffset: hunk.startOffset + hunk.newText.length,
          originalText: hunk.oldText,
          newText: hunk.newText
        });

        executionTrace.push({
          step: i,
          status: 'APPLIED',
          hunk: hunk.oldText + ' -> ' + hunk.newText,
          currentText: wordParagraph.getText()
        });
      }

      return {
        success: true,
        finalText: wordParagraph.getText(),
        trace: executionTrace,
        journal
      };
    } catch (error) {
      executionTrace.push({
        step: journal.length,
        status: 'FAILED',
        error: error.message
      });

      const rollbackLog = [];
      const reversedJournal = [...journal].reverse();

      let rollbackSuccess = true;
      for (const entry of reversedJournal) {
        try {
          wordParagraph.applyHunkDirect(entry.startOffset, entry.endOffset, entry.newText, entry.originalText);
          rollbackLog.push({
            action: 'COMPENSATE_OK',
            reverted: entry.newText + ' -> ' + entry.originalText
          });
        } catch (rbErr) {
          rollbackSuccess = false;
          rollbackLog.push({
            action: 'COMPENSATE_FAIL',
            error: rbErr.message
          });
        }
      }

      const postRollbackText = wordParagraph.getText();
      const isRestored = postRollbackText === initialSnapshot;

      return {
        success: false,
        error: error.message,
        postRollbackText,
        isRestored,
        rollbackSuccess: rollbackSuccess && isRestored,
        rollbackLog,
        trace: executionTrace
      };
    }
  }
}

module.exports = {
  WordOfficeJsReplacer,
  WordMockParagraph,
  WordTransactionSimulator
};