/**
 * Special Elements & Rich Paragraph Model
 * 
 * Simulates a native document paragraph containing:
 * - Text Runs (with formats like normal, bold, italic)
 * - Hyperlinks (range of text + target url)
 * - Footnotes (anchors / references placed inline)
 * 
 * Used to verify format preservation and offset drift immunity.
 */

class SpecialElementsParagraph {
  constructor(rawStructure) {
    this.elements = JSON.parse(JSON.stringify(rawStructure));
  }

  getPlainText() {
    return this.elements.map(el => {
      if (el.type === 'footnote') {
        return '[^' + el.footnoteId + ']';
      }
      return el.text;
    }).join('');
  }

  getElementOffsets() {
    let currentOffset = 0;
    const mapped = [];

    for (const el of this.elements) {
      const displayStr = (el.type === 'footnote') ? ('[^' + el.footnoteId + ']') : el.text;
      const start = currentOffset;
      const end = currentOffset + displayStr.length;
      mapped.push({
        element: el,
        startOffset: start,
        endOffset: end,
        displayStr
      });
      currentOffset = end;
    }
    return mapped;
  }

  applyHunks(hunks, reverseOrder = true) {
    const sorted = [...hunks].sort((a, b) => reverseOrder ? (b.startOffset - a.startOffset) : (a.startOffset - b.startOffset));
    const logs = [];

    for (const hunk of sorted) {
      const offsetMap = this.getElementOffsets();
      const targetMeta = offsetMap.find(m => hunk.startOffset >= m.startOffset && hunk.startOffset < m.endOffset);

      if (!targetMeta) {
        logs.push({
          hunk,
          status: 'ERROR',
          message: 'Could not locate element at startOffset ' + hunk.startOffset
        });
        continue;
      }

      const relStart = hunk.startOffset - targetMeta.startOffset;
      const relEnd = hunk.endOffset - targetMeta.startOffset;
      const el = targetMeta.element;

      if (el.type === 'footnote') {
        logs.push({
          hunk,
          status: 'SKIPPED_OR_SPECIAL',
          message: 'Target intersects footnote anchor'
        });
      } else {
        const currentSlice = el.text.substring(relStart, relEnd);
        if (currentSlice !== hunk.oldText) {
          logs.push({
            hunk,
            status: 'DRIFT_MISMATCH',
            expected: hunk.oldText,
            found: currentSlice,
            message: 'Offset drift in element! Expected ' + JSON.stringify(hunk.oldText) + ', found ' + JSON.stringify(currentSlice)
          });
        } else {
          el.text = el.text.substring(0, relStart) + hunk.newText + el.text.substring(relEnd);
          logs.push({
            hunk,
            status: 'APPLIED',
            appliedToType: el.type,
            formatPreserved: { ...el.format }
          });
        }
      }
    }

    return {
      finalPlainText: this.getPlainText(),
      elements: this.elements,
      logs
    };
  }

  clone() {
    return new SpecialElementsParagraph(this.elements);
  }
}

module.exports = { SpecialElementsParagraph };