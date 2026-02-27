import rawNotes from '../../notes.json';

export interface NoteDefinition {
  label: string;
  pitchClass: number;
  hex: string;
  bellPng: string;
  bellActivePng?: string;
  sampleMp3: string;
}

type NotesJson = Record<string, Omit<NoteDefinition, 'label'>>;

const notesRecord = rawNotes as NotesJson;

export const notes: NoteDefinition[] = Object.entries(notesRecord).map(([label, value]) => ({
  label,
  ...value
}));

export function normalizeAssetPath(path: string): string {
  const rawBase = import.meta.env.BASE_URL || '/';
  const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;

  // Resolve against current origin so GitHub Pages base-path behavior is consistent.
  return new URL(`${base}${cleanPath}`, window.location.origin).toString();
}
