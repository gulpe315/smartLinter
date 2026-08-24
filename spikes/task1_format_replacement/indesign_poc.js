/**
 * InDesign (ExtendScript & UXP) Atomic Transaction & Replacement Engine PoC
 */

class InDesignMockParagraph {
  constructor(initialText, styles = []) {
    this.text = initialText;
    this.styles = styles.length > 0 ? styles : [{ start: 0, end: initialText.length, style: 'BodyText' }];
  }

  getText() {
    return this.text;
  }

  replaceCharacterRange(startOffset, endOffset, oldText, newText) {
    const currentSlice = this.text.substring(startOffset, endOffset);
    if (currentSlice !== oldText) {
      throw new Error('InDesign DOM Range error: Expected ' + JSON.stringify(oldText) + ' at [' + startOffset + ':' + endOffset + '], found ' + JSON.stringify(currentSlice));
    }

    this.text = this.text.substring(0, startOffset) + newText + this.text.substring(endOffset);
  }
}

class InDesignMockApp {
  static UndoModes = {
    ENTIRE_SCRIPT: 'ENTIRE_SCRIPT',
    FAST_ENTIRE_SCRIPT: 'FAST_ENTIRE_SCRIPT',
    AUTO_UNDO: 'AUTO_UNDO'
  };

  static doScript(callback, undoMode, undoName, paragraph) {
    const snapshot = {
      text: paragraph.getText(),
      styles: JSON.parse(JSON.stringify(paragraph.styles))
    };

    try {
      const result = callback();
      return {
        success: true,
        undoName,
        undoMode,
        finalText: paragraph.getText(),
        result
      };
    } catch (error) {
      if (undoMode === InDesignMockApp.UndoModes.ENTIRE_SCRIPT || undoMode === InDesignMockApp.UndoModes.FAST_ENTIRE_SCRIPT) {
        paragraph.text = snapshot.text;
        paragraph.styles = snapshot.styles;

        return {
          success: false,
          rolledBack: true,
          rollbackMode: 'ATOMIC_ENTIRE_SCRIPT',
          error: error.message,
          postRollbackText: paragraph.getText()
        };
      } else {
        return {
          success: false,
          rolledBack: false,
          error: error.message,
          corruptedText: paragraph.getText()
        };
      }
    }
  }
}

class InDesignReplacer {
  static execute(paragraph, hunks, options = {}) {
    const { simulateErrorAtHunk = -1, undoMode = InDesignMockApp.UndoModes.ENTIRE_SCRIPT } = options;

    return InDesignMockApp.doScript(
      () => {
        const sortedHunks = [...hunks].sort((a, b) => b.startOffset - a.startOffset);
        const executionLog = [];

        for (let i = 0; i < sortedHunks.length; i++) {
          const hunk = sortedHunks[i];

          if (simulateErrorAtHunk === i) {
            throw new Error('InDesign DOM mutation error at hunk #' + i + ' (Target: ' + JSON.stringify(hunk.oldText) + ')');
          }

          paragraph.replaceCharacterRange(hunk.startOffset, hunk.endOffset, hunk.oldText, hunk.newText);
          executionLog.push({
            hunkIndex: i,
            applied: hunk.oldText + ' -> ' + hunk.newText,
            currentText: paragraph.getText()
          });
        }

        return executionLog;
      },
      undoMode,
      'SmartLinter Multi-Hunk Replace',
      paragraph
    );
  }
}

module.exports = {
  InDesignMockParagraph,
  InDesignMockApp,
  InDesignReplacer
};