// Raw palette. Change these values to re-theme the app.
const palette = {
  black: '#000000',
  nearBlack: '#0b0b0c',
  card: '#1c1c1e',
  cardAlt: '#242426',
  border: '#333335',
  white: '#ffffff',
  gray200: '#e5e5e7',
  gray400: '#aeaeb2',
  gray500: '#8e8e93',
  gray700: '#636366',
  gold: '#f5c518',
  goldMuted: '#7a6410',
  green: '#34c759',
  greenMuted: '#1f4d2b',
  red: '#ff453a',
};

// Semantic aliases used throughout the app. Prefer these over raw hex values.
export const Colors = {
  background: palette.black,
  surface: palette.card,
  surfaceAlt: palette.cardAlt,
  border: palette.border,
  placeholder: palette.cardAlt,

  textPrimary: palette.white,
  textSecondary: palette.gray200,
  textMuted: palette.gray500,
  textFaint: palette.gray700,

  accent: palette.gold,
  accentMuted: palette.goldMuted,
  accentText: palette.black,

  success: palette.green,
  successMuted: palette.greenMuted,

  activeBg: palette.gold,
  activeText: palette.black,
  inactiveText: palette.gray400,

  error: palette.red,
};
