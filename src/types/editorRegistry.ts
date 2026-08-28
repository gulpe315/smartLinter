export type EditorTargetId = 'Word' | 'InDesign' | 'VSCode' | 'Antigravity' | 'PowerPoint';

export type EditorConnectionMode = 'editor_initiated' | 'host_initiated';

export interface EditorTargetDescriptor {
  id: EditorTargetId;
  label: string;
  shortLabel: string;
  badgeColor: { bg: string; text: string; border: string };
  connectionMode: EditorConnectionMode;
  availability: 'available' | 'coming_soon';
  waitingMessage: string;
}

export const editorTargetRegistry: EditorTargetDescriptor[] = [
  {
    id: 'Word', label: 'Microsoft Word', shortLabel: 'W',
    badgeColor: { bg: 'bg-blue-950/60', text: 'text-blue-200', border: 'border-blue-700/60' },
    connectionMode: 'editor_initiated', availability: 'available',
    waitingMessage: 'Word에서 문서를 열고 SmartLinter 작업창을 활성화하면 자동으로 연결됩니다.',
  },
  {
    id: 'InDesign', label: 'Adobe InDesign', shortLabel: 'Id',
    badgeColor: { bg: 'bg-pink-950/60', text: 'text-pink-200', border: 'border-pink-700/60' },
    connectionMode: 'host_initiated', availability: 'available',
    waitingMessage: 'Adobe InDesign에 연결하고 있습니다.',
  },
  {
    id: 'VSCode', label: 'Visual Studio Code', shortLabel: 'VS',
    badgeColor: { bg: 'bg-sky-950/60', text: 'text-sky-200', border: 'border-sky-700/60' },
    connectionMode: 'editor_initiated', availability: 'coming_soon', waitingMessage: '준비 중입니다.',
  },
  {
    id: 'Antigravity', label: 'Antigravity', shortLabel: 'A',
    badgeColor: { bg: 'bg-violet-950/60', text: 'text-violet-200', border: 'border-violet-700/60' },
    connectionMode: 'editor_initiated', availability: 'coming_soon', waitingMessage: '준비 중입니다.',
  },
  {
    id: 'PowerPoint', label: 'Microsoft PowerPoint', shortLabel: 'P',
    badgeColor: { bg: 'bg-orange-950/60', text: 'text-orange-200', border: 'border-orange-700/60' },
    connectionMode: 'editor_initiated', availability: 'coming_soon', waitingMessage: '준비 중입니다.',
  },
];

export const getEditorTarget = (id: EditorTargetId | null) =>
  editorTargetRegistry.find((target) => target.id === id) ?? null;
