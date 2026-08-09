// Folia-compatible type shim for the ported Sonnet visualizer.
export interface LyricSyllable {
  text: string;
  startTime: number;
  endTime: number;
}

export interface Word {
  text: string;
  startTime: number;
  endTime: number;
  syllables?: LyricSyllable[];
}

export type LineTimingClass = 'normal' | 'short' | 'micro';
export type LineTransitionMode = 'normal' | 'fast' | 'none';
export type WordRevealMode = 'normal' | 'fast' | 'instant';

export interface LineRenderHints {
  rawDuration: number;
  timingClass: LineTimingClass;
  renderEndTime: number;
  lineTransitionMode: LineTransitionMode;
  wordRevealMode: WordRevealMode;
}

export interface Line {
  words: Word[];
  startTime: number;
  endTime: number;
  fullText: string;
  translation?: string;
  songPart?: string;
  blockIndex?: number;
  isChorus?: boolean;
  renderHints?: LineRenderHints;
}

export interface Theme {
  name: string;
  backgroundColor: string;
  primaryColor: string;
  accentColor: string;
  secondaryColor: string;
  fontStyle: 'sans' | 'serif' | 'mono';
  fontFamily?: string;
  fontFamilyStack?: string[];
  fontWeight?: number;
  animationIntensity: 'calm' | 'normal' | 'chaotic';
  wordColors?: { word: string; color: string }[];
  lyricsIcons?: string[];
  provider?: string;
  description?: string;
}

export type SonnetOuterFrameMode = 'none' | 'full';

export interface SonnetTuning {
  cameraIntensity: number;
  typographyMotion: number;
  mgDensity: number;
  showOnlyText: boolean;
  showGuide: boolean;
  showBackgroundMg: boolean;
  showFixedGeo: boolean;
  showGiantDecorativeText: boolean;
  showBackgroundDecor: boolean;
  enableTransitions: boolean;
  outerFrameMode: SonnetOuterFrameMode;
  textureResolution: number;
}

export const DEFAULT_SONNET_TUNING: SonnetTuning = {
  cameraIntensity: 1,
  typographyMotion: 1,
  mgDensity: 1,
  showOnlyText: false,
  showGuide: true,
  showBackgroundMg: true,
  showFixedGeo: true,
  showGiantDecorativeText: true,
  showBackgroundDecor: true,
  enableTransitions: true,
  outerFrameMode: 'full',
  textureResolution: 1.5,
};

export interface MotionValueLike<T = number> {
  get(): T;
}

export interface AudioBands {
  bass?: MotionValueLike<number>;
  lowMid?: MotionValueLike<number>;
  mid?: MotionValueLike<number>;
  vocal?: MotionValueLike<number>;
  treble?: MotionValueLike<number>;
  spectrum?: MotionValueLike<Uint8Array<ArrayBuffer>>;
}
