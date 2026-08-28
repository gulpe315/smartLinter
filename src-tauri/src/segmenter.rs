//! Sentence/TU boundary contract shared by QA-adjacent UI features and TM storage.
//!
//! Hard breaks are paragraph breaks (`\n`); soft breaks are `.`, `!`, `?`, and
//! `…` when followed by whitespace or the end of the text. Tabs are ordinary
//! whitespace, not a boundary. Japanese `。` is deliberately excluded because
//! the current product contract is Korean/English; revisit this when Japanese
//! documents are explicitly supported. Terminators remain with their sentence,
//! while newline separators are removed and every segment is trimmed.

use serde::Serialize;

/// A trimmed sentence/TU and its UTF-16 code-unit offsets in the original text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentSpan {
    pub text: String,
    pub start: u32,
    pub end: u32,
}

/// Splits text according to the SmartLinter sentence/TU boundary contract.
pub fn segment_sentences(text: &str) -> Vec<SegmentSpan> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut utf16_offsets = Vec::with_capacity(chars.len() + 1);
    let mut offset = 0u32;
    for (_, ch) in &chars {
        utf16_offsets.push(offset);
        offset += ch.len_utf16() as u32;
    }
    utf16_offsets.push(offset);

    let mut spans = Vec::new();
    let mut segment_start = 0usize;
    for (index, (_, ch)) in chars.iter().enumerate() {
        let is_newline = *ch == '\n';
        let is_soft_break = matches!(*ch, '.' | '!' | '?' | '…')
            && chars.get(index + 1).map(|(_, next)| next.is_whitespace()).unwrap_or(true);
        if is_newline || is_soft_break {
            let end = if is_newline { index } else { index + 1 };
            push_trimmed_span(text, &chars, &utf16_offsets, segment_start, end, &mut spans);
            segment_start = index + 1;
        }
    }
    push_trimmed_span(text, &chars, &utf16_offsets, segment_start, chars.len(), &mut spans);
    spans
}

fn push_trimmed_span(
    text: &str,
    chars: &[(usize, char)],
    utf16_offsets: &[u32],
    start: usize,
    end: usize,
    spans: &mut Vec<SegmentSpan>,
) {
    let mut first = start;
    let mut last = end;
    while first < last && chars[first].1.is_whitespace() { first += 1; }
    while last > first && chars[last - 1].1.is_whitespace() { last -= 1; }
    if first == last { return; }
    let byte_start = chars[first].0;
    let byte_end = if last == chars.len() { text.len() } else { chars[last].0 };
    spans.push(SegmentSpan {
        text: text[byte_start..byte_end].to_string(),
        start: utf16_offsets[first],
        end: utf16_offsets[last],
    });
}

#[cfg(test)]
mod tests {
    use super::segment_sentences;

    fn texts(text: &str) -> Vec<String> {
        segment_sentences(text).into_iter().map(|span| span.text).collect()
    }

    #[test]
    fn splits_multiple_sentences_and_preserves_terminators() {
        assert_eq!(texts("첫 문장입니다. 다음 문장입니다!"), ["첫 문장입니다.", "다음 문장입니다!"]);
    }

    #[test]
    fn splits_at_ellipsis() {
        assert_eq!(texts("잠시만요… 다음 문장입니다."), ["잠시만요…", "다음 문장입니다."]);
    }

    #[test]
    fn keeps_versions_decimals_and_urls_together() {
        assert_eq!(texts("버전 v2.0은 1.5배이며 docs.google.com에서 확인합니다."), ["버전 v2.0은 1.5배이며 docs.google.com에서 확인합니다."]);
    }

    #[test]
    fn newlines_are_hard_breaks_and_offsets_are_utf16() {
        let spans = segment_sentences("첫😀 문장\n  다음 문장");
        assert_eq!(texts("첫😀 문장\n  다음 문장"), ["첫😀 문장", "다음 문장"]);
        assert_eq!((spans[0].start, spans[0].end), (0, 6));
        assert_eq!((spans[1].start, spans[1].end), (9, 14));
    }

    /// Measurement-only manual check; never gates CI or includes customer text in source.
    #[test]
    #[ignore]
    fn reports_customer_tmx_sentence_statistics_when_available() {
        let path = std::path::Path::new("../KO-EN.tmx");
        if let Ok(contents) = std::fs::read_to_string(path) {
            println!("KO-EN.tmx sentence segments: {}", segment_sentences(&contents).len());
        }
    }
}
