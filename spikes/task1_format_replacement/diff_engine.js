/**
 * Multi-Hunk Diff & Replacement Engine
 * 
 * Demonstrates:
 * 1. Forward vs Reverse-order multi-hunk text replacement.
 * 2. Offset drift calculation and defense.
 */

class DiffEngine {
  static sortHunksReverse(hunks) {
    return [...hunks].sort((a, b) => b.startOffset - a.startOffset);
  }

  static sortHunksForward(hunks) {
    return [...hunks].sort((a, b) => a.startOffset - b.startOffset);
  }

  static replaceForward(originalText, hunks) {
    const sorted = this.sortHunksForward(hunks);
    let result = originalText;
    const executionLog = [];
    let driftErrors = 0;

    for (let i = 0; i < sorted.length; i++) {
      const hunk = sorted[i];
      const targetSlice = result.substring(hunk.startOffset, hunk.endOffset);
      const isMatch = targetSlice === hunk.oldText;

      if (!isMatch) {
        driftErrors++;
        executionLog.push({
          hunkIndex: i,
          status: 'DRIFT_ERROR',
          expectedOffset: [hunk.startOffset, hunk.endOffset],
          expectedText: hunk.oldText,
          actualTextFound: targetSlice,
          message: 'Offset drift detected! Expected ' + JSON.stringify(hunk.oldText) + ' at [' + hunk.startOffset + ':' + hunk.endOffset + '], but found ' + JSON.stringify(targetSlice)
        });
      } else {
        result = result.substring(0, hunk.startOffset) + hunk.newText + result.substring(hunk.endOffset);
        executionLog.push({
          hunkIndex: i,
          status: 'SUCCESS',
          appliedOffset: [hunk.startOffset, hunk.endOffset],
          oldText: hunk.oldText,
          newText: hunk.newText
        });
      }
    }

    return {
      finalText: result,
      driftErrors,
      executionLog
    };
  }

  static replaceReverse(originalText, hunks) {
    const sorted = this.sortHunksReverse(hunks);
    let result = originalText;
    const executionLog = [];
    let driftErrors = 0;

    for (let i = 0; i < sorted.length; i++) {
      const hunk = sorted[i];
      const targetSlice = result.substring(hunk.startOffset, hunk.endOffset);
      const isMatch = targetSlice === hunk.oldText;

      if (!isMatch) {
        driftErrors++;
        executionLog.push({
          hunkIndex: i,
          status: 'DRIFT_ERROR',
          expectedOffset: [hunk.startOffset, hunk.endOffset],
          expectedText: hunk.oldText,
          actualTextFound: targetSlice,
          message: 'Offset mismatch at [' + hunk.startOffset + ':' + hunk.endOffset + ']'
        });
      } else {
        result = result.substring(0, hunk.startOffset) + hunk.newText + result.substring(hunk.endOffset);
        executionLog.push({
          hunkIndex: i,
          status: 'SUCCESS',
          appliedOffset: [hunk.startOffset, hunk.endOffset],
          oldText: hunk.oldText,
          newText: hunk.newText
        });
      }
    }

    return {
      finalText: result,
      driftErrors,
      executionLog
    };
  }
}

module.exports = { DiffEngine };