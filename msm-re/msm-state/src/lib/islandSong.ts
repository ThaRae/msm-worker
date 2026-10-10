/** Full MIDI arrangement preview, NOT the native adaptive loop controller. */
export type IslandSong = {
  version: 1;
  midi: string;
  duration: number;
  events: Array<{ start: number; end: number; url: string; gain: number; track: string; note: number }>;
  diagnostics: string[];
};
