//! SmartLinter TMX (XML) and JSON Translation Memory Parser
//!
//! Provides fast, robust parsers for Translation Memory eXchange (TMX 1.1 / 1.4 / 1.4b)
//! XML format and structured JSON TM files. Supports inline tag stripping, XML entity decoding,
//! CDATA parsing, and various JSON schema variations.

use std::fs;
use std::path::Path;

use serde::Deserialize;

use crate::tm::types::{TmEntry, TmError};

/// Parses a TMX (XML) string and extracts translation units into a vector of [`TmEntry`].
///
/// Supports:
/// - `<tu>` Translation Unit containers with optional `tuid` / `id` attribute.
/// - `<tuv>` Translation Unit Variant containers with `xml:lang` or `lang` attributes.
/// - `<seg>` Segment content, unescaping XML entities and stripping inline tags (`<bpt>`, `<ept>`, `<ph>`, etc.).
/// - Source/Target language pairing based on TMX header `srclang` or first/second `tuv` elements.
pub fn parse_tmx(xml_content: &str) -> Result<Vec<TmEntry>, TmError> {
    if xml_content.trim().is_empty() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let header_srclang = extract_header_srclang(xml_content);

    // Split by <tu ...> ... </tu> tags
    let mut pos = 0;
    while let Some(tu_start) = find_tag_start(xml_content, "tu", pos) {
        let after_tag_open = match xml_content[tu_start..].find('>') {
            Some(idx) => tu_start + idx + 1,
            None => break,
        };

        let tu_end = match find_tag_end(xml_content, "tu", after_tag_open) {
            Some(idx) => idx,
            None => {
                pos = after_tag_open;
                continue;
            }
        };

        let tu_open_header = &xml_content[tu_start..after_tag_open];
        let tu_id = extract_attribute(tu_open_header, "tuid")
            .or_else(|| extract_attribute(tu_open_header, "id"));

        let tu_body = &xml_content[after_tag_open..tu_end];
        if let Some(entry) = parse_single_tu(tu_body, tu_id, header_srclang.as_deref()) {
            entries.push(entry);
        }

        pos = tu_end + 4; // skip </tu>
    }

    Ok(entries)
}

/// Parses a single `<tu>` block content and extracts source and target segments.
fn parse_single_tu(tu_body: &str, tu_id: Option<String>, header_srclang: Option<&str>) -> Option<TmEntry> {
    let mut variants: Vec<(Option<String>, String)> = Vec::new();

    let mut pos = 0;
    while let Some(tuv_start) = find_tag_start(tu_body, "tuv", pos) {
        let after_tag_open = match tu_body[tuv_start..].find('>') {
            Some(idx) => tuv_start + idx + 1,
            None => break,
        };

        let tuv_end = match find_tag_end(tu_body, "tuv", after_tag_open) {
            Some(idx) => idx,
            None => break,
        };

        let tuv_open = &tu_body[tuv_start..after_tag_open];
        let lang = extract_attribute(tuv_open, "xml:lang")
            .or_else(|| extract_attribute(tuv_open, "lang"));

        let tuv_content = &tu_body[after_tag_open..tuv_end];
        if let Some(seg_text) = extract_seg_text(tuv_content) {
            let cleaned_text = clean_segment_text(&seg_text);
            if !cleaned_text.is_empty() {
                variants.push((lang, cleaned_text));
            }
        }

        pos = tuv_end + 5; // skip </tuv>
    }

    if variants.is_empty() {
        return None;
    }

    if variants.len() == 1 {
        let (lang, text) = variants.remove(0);
        return Some(TmEntry {
            id: tu_id,
            source: text,
            target: String::new(),
            source_lang: lang,
            target_lang: None,
        });
    }

    // Determine which variant is source and which is target
    let mut source_idx = 0;
    let mut target_idx = 1;

    if let Some(hdr_src) = header_srclang {
        let hdr_lower = hdr_src.to_lowercase();
        if let Some(pos) = variants.iter().position(|(l, _)| {
            l.as_deref()
                .map(|s| s.to_lowercase().starts_with(&hdr_lower) || hdr_lower.starts_with(&s.to_lowercase()))
                .unwrap_or(false)
        }) {
            source_idx = pos;
            target_idx = if source_idx == 0 { 1 } else { 0 };
        }
    } else {
        // Fallback: Check if any variant is marked with en / ko
        if let Some(en_pos) = variants.iter().position(|(l, _)| {
            l.as_deref()
                .map(|s| s.to_lowercase().starts_with("en"))
                .unwrap_or(false)
        }) {
            source_idx = en_pos;
            if let Some(ko_pos) = variants.iter().position(|(l, _)| {
                l.as_deref()
                    .map(|s| s.to_lowercase().starts_with("ko"))
                    .unwrap_or(false)
            }) {
                target_idx = ko_pos;
            } else {
                target_idx = if source_idx == 0 { 1 } else { 0 };
            }
        }
    }

    let (src_lang, src_text) = variants[source_idx].clone();
    let (tgt_lang, tgt_text) = variants[target_idx].clone();

    Some(TmEntry {
        id: tu_id,
        source: src_text,
        target: tgt_text,
        source_lang: src_lang,
        target_lang: tgt_lang,
    })
}

/// Extracts the text between `<seg>` and `</seg>`.
fn extract_seg_text(tuv_content: &str) -> Option<String> {
    let seg_start = find_tag_start(tuv_content, "seg", 0)?;
    let after_open = match tuv_content[seg_start..].find('>') {
        Some(idx) => seg_start + idx + 1,
        None => return None,
    };
    let seg_end = find_tag_end(tuv_content, "seg", after_open)?;
    Some(tuv_content[after_open..seg_end].to_string())
}

/// Strips internal XML tags (`<bpt>`, `<ph>`, `<hi>`, etc.), extracts CDATA, and unescapes entities.
pub fn clean_segment_text(raw_seg: &str) -> String {
    let mut result = String::with_capacity(raw_seg.len());
    let mut pos = 0;
    let bytes = raw_seg.as_bytes();
    let len = raw_seg.len();

    // Tags whose inner content is formatting markup and should be stripped completely
    let skip_content_tags = ["bpt", "ept", "ph", "it", "ut"];

    while pos < len {
        if bytes[pos] == b'<' {
            // Check for CDATA block
            if raw_seg[pos..].starts_with("<![CDATA[") {
                if let Some(cdata_end) = raw_seg[pos..].find("]]>") {
                    let cdata_content = &raw_seg[pos + 9..pos + cdata_end];
                    result.push_str(cdata_content);
                    pos += cdata_end + 3;
                    continue;
                }
            }

            // Find end of tag
            if let Some(close_idx) = raw_seg[pos..].find('>') {
                let tag_str = &raw_seg[pos + 1..pos + close_idx];
                let tag_name = tag_str
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .trim_start_matches('/');

                let is_self_closing = tag_str.ends_with('/') || tag_str.starts_with('/');

                if !is_self_closing && skip_content_tags.iter().any(|&t| tag_name.eq_ignore_ascii_case(t)) {
                    // Skip everything until the closing tag </tag_name>
                    let closing_pattern = format!("</{}", tag_name);
                    if let Some(end_tag_pos) = raw_seg[pos + close_idx + 1..].find(&closing_pattern) {
                        let after_end_tag = pos + close_idx + 1 + end_tag_pos;
                        if let Some(end_close) = raw_seg[after_end_tag..].find('>') {
                            pos = after_end_tag + end_close + 1;
                            continue;
                        }
                    }
                }

                pos += close_idx + 1;
                continue;
            } else {
                pos += 1;
                continue;
            }
        } else if bytes[pos] == b'&' {
            if let Some(semi_idx) = raw_seg[pos..].find(';') {
                if semi_idx <= 12 {
                    let entity_name = &raw_seg[pos + 1..pos + semi_idx];
                    result.push_str(&decode_xml_entity(entity_name));
                    pos += semi_idx + 1;
                    continue;
                }
            }
            result.push('&');
            pos += 1;
        } else {
            let ch = raw_seg[pos..].chars().next().unwrap();
            result.push(ch);
            pos += ch.len_utf8();
        }
    }

    result.trim().to_string()
}

/// Decodes standard XML and numeric character entities.
fn decode_xml_entity(entity: &str) -> String {
    match entity {
        "amp" => "&".to_string(),
        "lt" => "<".to_string(),
        "gt" => ">".to_string(),
        "quot" => "\"".to_string(),
        "apos" => "'".to_string(),
        "nbsp" => " ".to_string(),
        _ if entity.starts_with("#x") || entity.starts_with("#X") => {
            if let Ok(code) = u32::from_str_radix(&entity[2..], 16) {
                if let Some(ch) = char::from_u32(code) {
                    return ch.to_string();
                }
            }
            format!("&{};", entity)
        }
        _ if entity.starts_with('#') => {
            if let Ok(code) = entity[1..].parse::<u32>() {
                if let Some(ch) = char::from_u32(code) {
                    return ch.to_string();
                }
            }
            format!("&{};", entity)
        }
        _ => format!("&{};", entity),
    }
}

/// Extracts header source language attribute if present (`srclang="..."`).
fn extract_header_srclang(xml: &str) -> Option<String> {
    let header_start = find_tag_start(xml, "header", 0)?;
    let after_tag = xml[header_start..].find('>')?;
    let header_open = &xml[header_start..header_start + after_tag + 1];
    extract_attribute(header_open, "srclang")
}

/// Helper to find `<tag` starting at or after `from_pos`.
fn find_tag_start(haystack: &str, tag_name: &str, from_pos: usize) -> Option<usize> {
    if from_pos >= haystack.len() {
        return None;
    }
    let slice = &haystack[from_pos..];
    let mut cur = 0;
    while let Some(idx) = slice[cur..].find('<') {
        let tag_idx = cur + idx;
        let candidate = &slice[tag_idx + 1..];
        if candidate.starts_with(tag_name) {
            let next_byte = candidate.as_bytes().get(tag_name.len());
            if matches!(next_byte, Some(b' ') | Some(b'>') | Some(b'\n') | Some(b'\r') | Some(b'\t') | Some(b'/')) {
                return Some(from_pos + tag_idx);
            }
        }
        cur = tag_idx + 1;
    }
    None
}

/// Helper to find `</tag>` starting at or after `from_pos`.
fn find_tag_end(haystack: &str, tag_name: &str, from_pos: usize) -> Option<usize> {
    if from_pos >= haystack.len() {
        return None;
    }
    let slice = &haystack[from_pos..];
    let mut cur = 0;
    let pattern = format!("</{}", tag_name);
    while let Some(idx) = slice[cur..].find(&pattern) {
        let tag_idx = cur + idx;
        let after_tag = &slice[tag_idx + pattern.len()..];
        let next_byte = after_tag.as_bytes().first();
        if matches!(next_byte, Some(b'>') | Some(b' ') | Some(b'\n') | Some(b'\r') | Some(b'\t')) {
            return Some(from_pos + tag_idx);
        }
        cur = tag_idx + 1;
    }
    None
}

/// Extracts the value of an attribute `key="value"` from a tag header string.
fn extract_attribute(tag_header: &str, attr_name: &str) -> Option<String> {
    let patterns = [
        format!("{}=\"", attr_name),
        format!("{}='", attr_name),
        format!("{} =\"", attr_name),
        format!("{} ='", attr_name),
    ];

    for pattern in &patterns {
        if let Some(pos) = tag_header.find(pattern) {
            let quote_char = if pattern.ends_with('"') { '"' } else { '\'' };
            let val_start = pos + pattern.len();
            if let Some(val_end) = tag_header[val_start..].find(quote_char) {
                return Some(tag_header[val_start..val_start + val_end].to_string());
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// JSON TM Parsing
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct JsonTmWrapper {
    #[serde(default, rename = "sourceLang")]
    source_lang: Option<String>,
    #[serde(default, rename = "targetLang")]
    target_lang: Option<String>,
    #[serde(default)]
    units: Option<Vec<JsonTmItem>>,
    #[serde(default)]
    entries: Option<Vec<JsonTmItem>>,
    #[serde(default)]
    items: Option<Vec<JsonTmItem>>,
    #[serde(default)]
    translations: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
struct JsonTmItem {
    #[serde(default)]
    id: Option<serde_json::Value>,
    #[serde(default, alias = "src", alias = "sourceText", alias = "source_text")]
    source: Option<String>,
    #[serde(default, alias = "tgt", alias = "targetText", alias = "target_text")]
    target: Option<String>,
    #[serde(default, rename = "sourceLang", alias = "source_lang", alias = "src_lang")]
    source_lang: Option<String>,
    #[serde(default, rename = "targetLang", alias = "target_lang", alias = "tgt_lang")]
    target_lang: Option<String>,
}

/// Parses a structured JSON TM string into a vector of [`TmEntry`].
pub fn parse_json_tm(json_content: &str) -> Result<Vec<TmEntry>, TmError> {
    let trimmed = json_content.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    // Try parsing as array of items directly
    if trimmed.starts_with('[') {
        let items: Vec<JsonTmItem> = serde_json::from_str(trimmed)?;
        let entries = items
            .into_iter()
            .filter_map(convert_json_item_to_entry)
            .collect();
        return Ok(entries);
    }

    // Try parsing as object wrapper
    if trimmed.starts_with('{') {
        if let Ok(wrapper) = serde_json::from_str::<JsonTmWrapper>(trimmed) {
            let list = wrapper
                .units
                .or(wrapper.entries)
                .or(wrapper.items);

            if let Some(items) = list {
                let default_src = wrapper.source_lang;
                let default_tgt = wrapper.target_lang;

                let entries = items
                    .into_iter()
                    .filter_map(|mut item| {
                        if item.source_lang.is_none() {
                            item.source_lang = default_src.clone();
                        }
                        if item.target_lang.is_none() {
                            item.target_lang = default_tgt.clone();
                        }
                        convert_json_item_to_entry(item)
                    })
                    .collect();
                return Ok(entries);
            }

            if let Some(trans_map) = wrapper.translations {
                let entries = trans_map
                    .into_iter()
                    .map(|(k, v)| TmEntry {
                        id: None,
                        source: k,
                        target: v,
                        source_lang: wrapper.source_lang.clone(),
                        target_lang: wrapper.target_lang.clone(),
                    })
                    .collect();
                return Ok(entries);
            }
        }

        // Try direct key-value map
        if let Ok(map) = serde_json::from_str::<std::collections::HashMap<String, String>>(trimmed) {
            let entries = map
                .into_iter()
                .map(|(k, v)| TmEntry {
                    id: None,
                    source: k,
                    target: v,
                    source_lang: None,
                    target_lang: None,
                })
                .collect();
            return Ok(entries);
        }
    }

    Err(TmError::Json(serde::de::Error::custom("Unsupported JSON TM structure")))
}

fn convert_json_item_to_entry(item: JsonTmItem) -> Option<TmEntry> {
    let source = item.source?.trim().to_string();
    let target = item.target.unwrap_or_default().trim().to_string();

    if source.is_empty() {
        return None;
    }

    let id = item.id.map(|v| match v {
        serde_json::Value::String(s) => s,
        serde_json::Value::Number(n) => n.to_string(),
        other => other.to_string(),
    });

    Some(TmEntry {
        id,
        source,
        target,
        source_lang: item.source_lang,
        target_lang: item.target_lang,
    })
}

/// Automatically detects TM format (TMX XML or JSON) from content or format hint, and parses it.
pub fn parse_tm_content(content: &str, format_hint: Option<&str>) -> Result<Vec<TmEntry>, TmError> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    if let Some(hint) = format_hint {
        match hint.to_lowercase().as_str() {
            "tmx" | "xml" => return parse_tmx(content),
            "json" => return parse_json_tm(content),
            _ => {}
        }
    }

    // Auto detection
    if trimmed.starts_with('<') {
        parse_tmx(content)
    } else if trimmed.starts_with('{') || trimmed.starts_with('[') {
        parse_json_tm(content)
    } else {
        Err(TmError::UnsupportedFormat(
            "Could not determine TM format (neither XML nor JSON)".to_string(),
        ))
    }
}

/// Loads a TM file from disk, auto-detecting format by extension or content.
pub fn load_tm_file<P: AsRef<Path>>(path: P) -> Result<Vec<TmEntry>, TmError> {
    let path_ref = path.as_ref();
    let content = fs::read_to_string(path_ref)?;
    let extension = path_ref
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_lowercase());

    parse_tm_content(&content, extension.as_deref())
}
