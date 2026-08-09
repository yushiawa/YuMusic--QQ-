// Folia Sonnet runtime bundle entry.
import { compileSonnetProgram } from './folia/components/visualizer/sonnet/sonnetProgram';
import { SonnetPixiRuntime } from './folia/components/visualizer/sonnet/createSonnetPixiRuntime';
import { DEFAULT_SONNET_TUNING } from './folia/types';
import { buildLineGraphemeTimeline, splitLyricGraphemes } from './folia/utils/lyrics/graphemeTiming';
import { annotateLyricLines } from './folia/utils/lyrics/renderHints';
import { sonnetDebugState } from './folia/components/visualizer/sonnet/sonnetDebug';

window.FoliaSonnet = {
  compileSonnetProgram,
  SonnetPixiRuntime,
  DEFAULT_SONNET_TUNING,
  buildLineGraphemeTimeline,
  splitLyricGraphemes,
  annotateLyricLines,
  sonnetDebugState,
};
