/**
 * Unit Tests for Guideline, TM Parsers and VRAM Budget Evaluator
 */

import { describe, it, expect } from 'vitest';
import {
  parseGuidelineContent,
  parseTmContent,
  parseTmx,
  parseJsonTm,
  cleanSegmentText,
} from '../parserUtils.ts';
import {
  evaluateVramWarning,
  DEFAULT_GUIDELINES,
} from '../../types/config.ts';

describe('parserUtils - Guideline Parser', () => {
  it('should parse markdown .agents file with headers and categories', () => {
    const md = `# Cloud Document Guidelines
Overview of formatting rules.

## Terminology
- Do not translate product name "SmartLinter"
- [UI Buttons] Always use bracket notation like [확인]

## Grammar & Style
- **Honorifics:** Always use polite honorific style (하십시오)
- Avoid passive voice (되어지다, 되어진다)
`;

    const result = parseGuidelineContent(md, '.agents');
    expect(result.name).toBe('Cloud Document Guidelines');
    expect(result.rules.length).toBe(4);

    expect(result.rules[0].category).toBe('Terminology');
    expect(result.rules[0].description).toBe('Do not translate product name "SmartLinter"');

    expect(result.rules[1].category).toBe('UI Buttons');
    expect(result.rules[1].description).toBe('Always use bracket notation like [확인]');

    expect(result.rules[2].category).toBe('Honorifics');
    expect(result.rules[2].description).toBe('Always use polite honorific style (하십시오)');

    expect(result.rules[3].category).toBe('Grammar & Style');
    expect(result.rules[3].description).toBe('Avoid passive voice (되어지다, 되어진다)');
  });

  it('should parse JSON guidelines array and object formats', () => {
    const jsonArray = JSON.stringify([
      { id: 'R01', category: 'Terminology', description: 'Keep AWS untranslated', severity: 'HIGH' },
      { id: 'R02', category: 'Punctuation', description: 'Space before units (10 GB)', severity: 'LOW' },
    ]);

    const resArray = parseGuidelineContent(jsonArray, 'rules.json');
    expect(resArray.rules.length).toBe(2);
    expect(resArray.rules[0].id).toBe('R01');
    expect(resArray.rules[0].severity).toBe('HIGH');

    const jsonObj = JSON.stringify({
      name: 'Custom Project Rules',
      description: 'Project QA Rules',
      rules: [
        { id: 'R10', type: 'Style', rule: 'Be concise', example: 'Good: 간결하게' },
      ],
    });

    const resObj = parseGuidelineContent(jsonObj);
    expect(resObj.name).toBe('Custom Project Rules');
    expect(resObj.rules.length).toBe(1);
    expect(resObj.rules[0].category).toBe('Style');
    expect(resObj.rules[0].description).toBe('Be concise');
    expect(resObj.rules[0].example).toBe('Good: 간결하게');
  });

  it('should handle empty or whitespace content gracefully', () => {
    const emptyRes = parseGuidelineContent('   ', 'default.md');
    expect(emptyRes.rules.length).toBe(0);
    expect(emptyRes.name).toBe('default.md');
  });
});

describe('parserUtils - Translation Memory (TMX & JSON)', () => {
  it('should parse TMX XML content with entities and stripped formatting tags', () => {
    const tmx = `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header srclang="en" />
  <body>
    <tu tuid="tu-001">
      <tuv xml:lang="en">
        <seg>Click the <bpt i="1">&lt;b&gt;</bpt>Settings<ept i="1">&lt;/b&gt;</ept> button &amp; proceed.</seg>
      </tuv>
      <tuv xml:lang="ko">
        <seg><bpt i="1">&lt;b&gt;</bpt>설정<ept i="1">&lt;/b&gt;</ept> 버튼을 클릭하고 &amp; 계속하십시오.</seg>
      </tuv>
    </tu>
    <tu tuid="tu-002">
      <tuv xml:lang="en">
        <seg><![CDATA[Save document now.]]></seg>
      </tuv>
      <tuv xml:lang="ko">
        <seg><![CDATA[지금 문서를 저장하십시오.]]></seg>
      </tuv>
    </tu>
  </body>
</tmx>`;

    const entries = parseTmx(tmx);
    expect(entries.length).toBe(2);

    expect(entries[0].id).toBe('tu-001');
    expect(entries[0].source).toBe('Click the Settings button & proceed.');
    expect(entries[0].target).toBe('설정 버튼을 클릭하고 & 계속하십시오.');
    expect(entries[0].sourceLang).toBe('en');
    expect(entries[0].targetLang).toBe('ko');

    expect(entries[1].id).toBe('tu-002');
    expect(entries[1].source).toBe('Save document now.');
    expect(entries[1].target).toBe('지금 문서를 저장하십시오.');
  });

  it('should parse JSON TM files across formats', () => {
    const jsonUnits = JSON.stringify({
      sourceLang: 'en',
      targetLang: 'ko',
      units: [
        { id: 1, source: 'Hello world', target: '안녕하세요 세계' },
        { id: 2, src: 'Open File', tgt: '파일 열기' },
      ],
    });

    const entriesUnits = parseJsonTm(jsonUnits);
    expect(entriesUnits.length).toBe(2);
    expect(entriesUnits[0].source).toBe('Hello world');
    expect(entriesUnits[0].target).toBe('안녕하세요 세계');
    expect(entriesUnits[1].source).toBe('Open File');
    expect(entriesUnits[1].target).toBe('파일 열기');

    const jsonDictionary = JSON.stringify({
      'Cancel': '취소',
      'OK': '확인',
    });

    const entriesDict = parseJsonTm(jsonDictionary);
    expect(entriesDict.length).toBe(2);
    expect(entriesDict.find((e) => e.source === 'Cancel')?.target).toBe('취소');
  });

  it('should clean segment text helper properly', () => {
    const raw = '<bpt i="1">&lt;b&gt;</bpt>Hello &amp; <ph id="1">{username}</ph> World<ept i="1">&lt;/b&gt;</ept>';
    const cleaned = cleanSegmentText(raw);
    expect(cleaned).toBe('Hello &  World');
  });
});

describe('evaluateVramWarning', () => {
  it('should not flag warning for 7B/8B models under 5.5GB', () => {
    const res7b = evaluateVramWarning(4_400_000_000, '7.6B');
    expect(res7b.vramWarning).toBe(false);
    expect(res7b.vramWarningReason).toBeUndefined();

    const res8b = evaluateVramWarning(4_700_000_000, '8.0B');
    expect(res8b.vramWarning).toBe(false);
  });

  it('should flag warning for models over 5.5GB or >8.0B parameters', () => {
    const resLargeSize = evaluateVramWarning(6_000_000_000, '7.0B');
    expect(resLargeSize.vramWarning).toBe(true);
    expect(resLargeSize.vramWarningReason).toContain('8GB VRAM 권장 안전 한도');

    const res14b = evaluateVramWarning(9_000_000_000, '14.7B');
    expect(res14b.vramWarning).toBe(true);
    expect(res14b.vramWarningReason).toContain('8GB VRAM 권장 한도');

    const res9b = evaluateVramWarning(5_200_000_000, '9.2B');
    expect(res9b.vramWarning).toBe(true);
  });
});
