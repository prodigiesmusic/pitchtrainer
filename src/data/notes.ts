import rawNotes from '../../notes.json';

export interface NoteDefinition {
  label: string;
  pitchClass: number;
  hex: string;
  bellPng: string;
  sampleMp3: string;
}

type NotesJson = Record<string, Omit<NoteDefinition, 'label'>>;

const notesRecord = rawNotes as NotesJson;

export const notes: NoteDefinition[] = Object.entries(notesRecord).map(([label, value]) => ({
  label,
  ...value
}));

export function normalizeAssetPath(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `${base}${cleanPath}`;
}
