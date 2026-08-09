// React-free icon stub for the ported Sonnet visualizer.
// Produces cacheable SVG data URLs without lucide-react / react-dom/server.

const ICON_PATHS: Record<string, string> = {
  Flower: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 8v5m0-13V3m4.95 2.05-3.54 3.54m1.42 8.48 3.53 3.54M8 5.05l3.54 3.54m-1.42 8.48L6.6 20.6',
  Sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zm7 11 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14zM5 14l.9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9L5 14z',
  Heart: 'M12 21s-7.5-4.7-10-9.2C.6 8.6 2.5 5 6 5c2 0 3.3 1 4 2 .7-1 2-2 4-2 3.5 0 5.4 3.6 4 6.8C19.5 16.3 12 21 12 21z',
  Music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  Star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2z',
  Sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-15v2m0 16v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M2 12h2m16 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  Moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  Cloud: 'M17.5 19a4.5 4.5 0 0 0 .4-9 7 7 0 0 0-13.4 2A4 4 0 0 0 6 19h11.5z',
  Droplet: 'M12 2.7S6 9 6 14a6 6 0 0 0 12 0c0-5-6-11.3-6-11.3z',
  Zap: 'M13 2 4 14h6l-1 8 9-12h-6l1-8z',
  Disc: 'M12 12m-10 0a10 10 0 1 0 20 0 10 10 0 1 0-20 0zm10 0m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0z',
  Mic: 'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zm-6 9a6 6 0 0 0 12 0m-6 6v4m-4 0h8',
  Headphones: 'M4 14v-2a8 8 0 0 1 16 0v2m-14 0a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1v-6H4zm14 0h-1v6h1a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2z',
  Wind: 'M3 8h9a3 3 0 1 0-3-3m-6 8h13a3 3 0 1 1-3 3m-10 0H3',
};

const ICON_NAMES = Object.keys(ICON_PATHS);
const ICON_NAMES_BY_LOWERCASE = new Map(ICON_NAMES.map(name => [name.toLowerCase(), name]));

export const resolveSonnetIconNames = (names: string[] | undefined): string[] => {
  const resolved = [
    ...new Set((names ?? [])
      .map(name => ICON_NAMES_BY_LOWERCASE.get(String(name).toLowerCase()))
      .filter(Boolean)),
  ] as string[];
  return resolved.length > 0 ? resolved : ['Flower'];
};

export const buildSonnetIconParticleIndices = (
  iconCount: number,
  particleCount: number,
  seed: number,
): Array<number | null> => {
  const safeIconCount = Math.max(0, Math.floor(iconCount));
  const safeParticleCount = Math.max(0, Math.floor(particleCount));
  if (safeIconCount === 0) {
    return Array.from({ length: safeParticleCount }, () => null);
  }
  const iconParticleCount = Math.min(
    safeParticleCount,
    Math.max(Math.ceil(safeParticleCount / 4), safeIconCount),
  );
  let emittedIconCount = 0;
  return Array.from({ length: safeParticleCount }, (_, index) => {
    const previousBand = Math.floor((index * iconParticleCount) / safeParticleCount);
    const currentBand = Math.floor(((index + 1) * iconParticleCount) / safeParticleCount);
    if (currentBand === previousBand) return null;
    const iconIndex = ((seed + emittedIconCount) % safeIconCount + safeIconCount) % safeIconCount;
    emittedIconCount += 1;
    return iconIndex;
  });
};

export const resolveSonnetIconEntryPhase = (index: number, iconCount: number) => {
  const safeCount = Math.max(0, Math.floor(iconCount));
  if (safeCount <= 1) return 0.12;
  const safeIndex = Math.min(safeCount - 1, Math.max(0, Math.floor(index)));
  return 0.04 + (safeIndex / (safeCount - 1)) * 0.82;
};

export const resolveSonnetIconEntryDuration = (sceneDuration: number, preferredDuration: number) => {
  const safeSceneDuration = Math.max(0.01, sceneDuration);
  return Math.min(
    Math.max(0.01, preferredDuration),
    Math.max(0.08, safeSceneDuration * 0.18),
    safeSceneDuration,
  );
};

export const resolveSonnetIconEntryDelay = (
  entryPhase: number,
  sceneDuration: number,
  entryDuration: number,
) => Math.min(1, Math.max(0, entryPhase)) * Math.max(0, sceneDuration - entryDuration);

export const buildSonnetIconTextureKey = (
  name: string,
  color: string,
  strokeWidth: number,
  size: number,
  resolution: number,
) => `${name}|${color}|${strokeWidth}|${size}|${resolution}`;

const buildIconSvg = (path: string, color: string, strokeWidth: number, size: number) => {
  const stroke = Math.max(1, strokeWidth * (size / 24));
  const paths = path
    .split('m')
    .map((part, index) => (index === 0 ? part : 'm' + part))
    .filter(part => part.trim().length > 0)
    .map(part => `<path d="${part}" fill="none" stroke="${color}" stroke-width="${stroke.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${paths}</svg>`;
};

export const buildSonnetIconDataUrl = (
  name: string,
  color: string,
  strokeWidth: number,
  size: number,
) => {
  const path = ICON_PATHS[name] ?? ICON_PATHS.Flower;
  const svg = buildIconSvg(path, color, strokeWidth, size);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};
