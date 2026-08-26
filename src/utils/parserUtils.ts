/**
 * SmartLinter Client-Side Guideline & Translation Memory Parsers
 *
 * Implements robust parsing for .agents (Markdown/JSON) and TMX/JSON TM files
 * with XML entity decoding, inline tag cleanup, and format auto-detection.
 */

import {
  type GuidelineSet,
  type LanguageTag,
  type QaRule,
  type TmEntry,
} from '../types/config.ts';

// ---------------------------------------------------------------------------
// Guideline Parser (.agents Markdown & JSON)
// ---------------------------------------------------------------------------

export function parseGuidelineContent(content: string, fallbackName = '프로젝트 가이드라인'): GuidelineSet {
  const trimmed = content.trim();
  if (!trimmed) {
    return {
      language: 'ko',
      name: fallbackName,
      rules: [],
      rawContent: '',
    };
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseJsonGuidelines(trimmed, fallbackName);
  }

  return parseMarkdownGuidelines(trimmed, fallbackName);
}

interface JsonRuleRaw {
  id?: string;
  category?: string;
  type?: string;
  topic?: string;
  description?: string;
  rule?: string;
  instruction?: string;
  text?: string;
  severity?: string;
  example?: string;
}

interface JsonGuidelineWrapper {
  language?: string;
  name?: string;
  description?: string;
  rules?: JsonRuleRaw[];
  guidelines?: JsonRuleRaw[];
}

function parseLanguageTag(value: string | undefined): LanguageTag {
  return value === 'ko' || value === 'en' || value === 'ja' || value === 'zh' ? value : 'ko';
}

function parseJsonGuidelines(jsonStr: string, fallbackName: string): GuidelineSet {
  try {
    const parsed = JSON.parse(jsonStr);

    if (Array.isArray(parsed)) {
      const rules = parsed
        .map((item) => convertJsonRuleToQaRule(item))
        .filter((r): r is QaRule => r !== null);

      return {
        language: 'ko',
        name: fallbackName,
        rules,
        rawContent: jsonStr,
      };
    }

    if (typeof parsed === 'object' && parsed !== null) {
      const wrapper = parsed as JsonGuidelineWrapper;
      const rawList = wrapper.rules || wrapper.guidelines || [];
      const rules = rawList
        .map((item) => convertJsonRuleToQaRule(item))
        .filter((r): r is QaRule => r !== null);

      return {
        language: parseLanguageTag(wrapper.language),
        name: wrapper.name || fallbackName,
        description: wrapper.description,
        rules,
        rawContent: jsonStr,
      };
    }
  } catch (err) {
    console.warn('JSON guideline parse failed, falling back to markdown parser:', err);
  }

  return parseMarkdownGuidelines(jsonStr, fallbackName);
}

function convertJsonRuleToQaRule(item: JsonRuleRaw): QaRule | null {
  const desc = item.description || item.rule || item.instruction || item.text;
  if (!desc || !desc.trim()) return null;

  const category = (item.category || item.type || item.topic || 'General').trim();

  return {
    id: item.id,
    category: category || 'General',
    description: desc.trim(),
    severity: item.severity,
    example: item.example,
  };
}

function parseMarkdownGuidelines(mdStr: string, defaultName: string): GuidelineSet {
  const lines = mdStr.split(/\r?\n/);
  const rules: QaRule[] = [];
  let currentCategory = 'General';
  let setName = defaultName;
  let setDescription: string | undefined;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // # Header
    if (trimmed.startsWith('# ')) {
      setName = trimmed.replace(/^#\s+/, '').trim();
      continue;
    }

    // ## Section Category
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      const cat = trimmed.replace(/^#+\s+/, '').trim();
      if (!cat.toLowerCase().includes('overview') && !cat.toLowerCase().includes('description')) {
        currentCategory = cat;
      }
      continue;
    }

    // - Bullet rule, * Rule, • Rule
    if (trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('•')) {
      const ruleText = trimmed.slice(1).trim();
      const parsedRule = parseSingleMarkdownRule(ruleText, currentCategory);
      if (parsedRule) {
        rules.push(parsedRule);
      }
      continue;
    }

    // Numbered rule: 1. Rule
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numMatch) {
      const parsedRule = parseSingleMarkdownRule(numMatch[2].trim(), currentCategory);
      if (parsedRule) {
        rules.push(parsedRule);
      }
      continue;
    }

    // Capture first paragraph as description if not set
    if (!setDescription && !trimmed.startsWith('#')) {
      setDescription = trimmed;
    }
  }

  return {
    language: 'ko',
    name: setName,
    description: setDescription,
    rules,
    rawContent: mdStr,
  };
}

function parseSingleMarkdownRule(text: string, defaultCategory: string): QaRule | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // [Category] Rule text
  if (trimmed.startsWith('[')) {
    const bracketEnd = trimmed.indexOf(']');
    if (bracketEnd > 0) {
      const category = trimmed.slice(1, bracketEnd).trim();
      const desc = trimmed.slice(bracketEnd + 1).replace(/^:\s*/, '').trim();
      if (desc) {
        return { category: category || defaultCategory, description: desc };
      }
    }
  }

  // **Category:** Rule text or **Category**: Rule text
  const boldMatch = trimmed.match(/^\*\*([^*]+?)\*{1,2}:?\s*(.*)$/);
  if (boldMatch) {
    const rawCat = boldMatch[1].replace(/:$/, '').trim();
    const desc = boldMatch[2].trim();
    if (desc) {
      return { category: rawCat || defaultCategory, description: desc };
    }
  }

  return {
    category: defaultCategory,
    description: trimmed,
  };
}

// ---------------------------------------------------------------------------
// Translation Memory Parser (TMX & JSON)
// ---------------------------------------------------------------------------

export function parseTmContent(content: string, formatHint?: string): TmEntry[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const hint = formatHint?.toLowerCase();
  if (hint === 'tmx' || hint === 'xml' || trimmed.startsWith('<')) {
    return parseTmx(trimmed);
  }

  if (hint === 'json' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseJsonTm(trimmed);
  }

  // Auto detection
  if (trimmed.startsWith('<')) {
    return parseTmx(trimmed);
  }
  return parseJsonTm(trimmed);
}

/**
 * TMX Parser supporting standard TMX 1.1 / 1.4 / 1.4b
 */
export function parseTmx(xmlContent: string): TmEntry[] {
  const entries: TmEntry[] = [];
  const headerSrclang = extractHeaderSrclang(xmlContent);

  // Regex match for <tu ...> ... </tu>
  const tuRegex = /<tu\b([^>]*)>([\s\S]*?)<\/tu>/gi;
  let tuMatch: RegExpExecArray | null;

  while ((tuMatch = tuRegex.exec(xmlContent)) !== null) {
    const tuAttrs = tuMatch[1];
    const tuBody = tuMatch[2];

    const tuid = extractAttribute(tuAttrs, 'tuid') || extractAttribute(tuAttrs, 'id');
    const entry = parseSingleTu(tuBody, tuid, headerSrclang);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

function parseSingleTu(tuBody: string, tuId?: string, headerSrclang?: string): TmEntry | null {
  const variants: Array<{ lang?: string; text: string }> = [];

  const tuvRegex = /<tuv\b([^>]*)>([\s\S]*?)<\/tuv>/gi;
  let tuvMatch: RegExpExecArray | null;

  while ((tuvMatch = tuvRegex.exec(tuBody)) !== null) {
    const tuvAttrs = tuvMatch[1];
    const tuvBody = tuvMatch[2];

    const lang = extractAttribute(tuvAttrs, 'xml:lang') || extractAttribute(tuvAttrs, 'lang');
    const segMatch = /<seg\b[^>]*>([\s\S]*?)<\/seg>/i.exec(tuvBody);
    if (segMatch) {
      const cleaned = cleanSegmentText(segMatch[1]);
      if (cleaned) {
        variants.push({ lang, text: cleaned });
      }
    }
  }

  if (variants.length === 0) return null;

  if (variants.length === 1) {
    return {
      id: tuId,
      source: variants[0].text,
      target: '',
      sourceLang: variants[0].lang,
    };
  }

  let sourceIdx = 0;
  let targetIdx = 1;

  if (headerSrclang) {
    const hdrLower = headerSrclang.toLowerCase();
    const pos = variants.findIndex(
      (v) => v.lang && (v.lang.toLowerCase().startsWith(hdrLower) || hdrLower.startsWith(v.lang.toLowerCase()))
    );
    if (pos >= 0) {
      sourceIdx = pos;
      targetIdx = sourceIdx === 0 ? 1 : 0;
    }
  } else {
    // English -> Korean heuristic
    const enPos = variants.findIndex((v) => v.lang?.toLowerCase().startsWith('en'));
    if (enPos >= 0) {
      sourceIdx = enPos;
      const koPos = variants.findIndex((v) => v.lang?.toLowerCase().startsWith('ko'));
      targetIdx = koPos >= 0 ? koPos : (sourceIdx === 0 ? 1 : 0);
    }
  }

  return {
    id: tuId,
    source: variants[sourceIdx].text,
    target: variants[targetIdx].text,
    sourceLang: variants[sourceIdx].lang,
    targetLang: variants[targetIdx].lang,
  };
}

function extractHeaderSrclang(xml: string): string | undefined {
  const headerMatch = /<header\b([^>]*)>/i.exec(xml);
  if (!headerMatch) return undefined;
  return extractAttribute(headerMatch[1], 'srclang');
}

function extractAttribute(attrStr: string, attrName: string): string | undefined {
  const match = new RegExp(`${attrName}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrStr);
  return match ? match[1] : undefined;
}

export function cleanSegmentText(rawSeg: string): string {
  let cleaned = rawSeg;

  // 1. Extract CDATA
  cleaned = cleaned.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');

  // 2. Strip tags with skip-content like <bpt>...</bpt>, <ph>...</ph>, etc.
  cleaned = cleaned.replace(/<(bpt|ept|ph|it|ut)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  // 3. Strip remaining XML tags
  cleaned = cleaned.replace(/<[^>]+>/g, '');

  // 4. Decode XML entities
  cleaned = decodeXmlEntities(cleaned);

  return cleaned.trim();
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * JSON TM Parser supporting arrays, units/entries wrappers, and dictionary maps.
 */
interface JsonTmItemRaw {
  id?: string | number;
  source?: string;
  src?: string;
  sourceText?: string;
  source_text?: string;
  target?: string;
  tgt?: string;
  targetText?: string;
  target_text?: string;
  sourceLang?: string;
  source_lang?: string;
  src_lang?: string;
  targetLang?: string;
  target_lang?: string;
  tgt_lang?: string;
}

interface JsonTmWrapperRaw {
  sourceLang?: string;
  targetLang?: string;
  units?: JsonTmItemRaw[];
  entries?: JsonTmItemRaw[];
  items?: JsonTmItemRaw[];
  translations?: Record<string, string>;
}

export function parseJsonTm(jsonContent: string): TmEntry[] {
  const parsed = JSON.parse(jsonContent);

  // Array of items
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => convertJsonTmItemToEntry(item))
      .filter((e): e is TmEntry => e !== null);
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const wrapper = parsed as JsonTmWrapperRaw;
    const list = wrapper.units || wrapper.entries || wrapper.items;

    if (list && Array.isArray(list)) {
      return list
        .map((item) => {
          const itemWithLang: JsonTmItemRaw = {
            ...item,
            sourceLang: item.sourceLang || item.source_lang || wrapper.sourceLang,
            targetLang: item.targetLang || item.target_lang || wrapper.targetLang,
          };
          return convertJsonTmItemToEntry(itemWithLang);
        })
        .filter((e): e is TmEntry => e !== null);
    }

    if (wrapper.translations && typeof wrapper.translations === 'object') {
      return Object.entries(wrapper.translations).map(([src, tgt]) => ({
        source: src,
        target: tgt,
        sourceLang: wrapper.sourceLang,
        targetLang: wrapper.targetLang,
      }));
    }

    // Direct key-value dictionary map
    const entries: TmEntry[] = [];
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        entries.push({
          source: key,
          target: value,
        });
      }
    }
    if (entries.length > 0) return entries;
  }

  throw new Error('지원되지 않는 JSON TM 형식입니다.');
}

function convertJsonTmItemToEntry(item: JsonTmItemRaw): TmEntry | null {
  const source = (item.source || item.src || item.sourceText || item.source_text || '').trim();
  const target = (item.target || item.tgt || item.targetText || item.target_text || '').trim();

  if (!source) return null;

  return {
    id: item.id !== undefined ? String(item.id) : undefined,
    source,
    target,
    sourceLang: item.sourceLang || item.source_lang || item.src_lang,
    targetLang: item.targetLang || item.target_lang || item.tgt_lang,
  };
}
