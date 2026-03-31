export interface ThemeTokens {
  colors: {
    canvas: string;
    surface: string;
    surfaceStrong: string;
    surfaceGlass: string;
    line: string;
    lineStrong: string;
    text: string;
    textMuted: string;
    primary: string;
    primaryStrong: string;
    accent: string;
    accentSoft: string;
    success: string;
    warning: string;
    danger: string;
  };
  typography: {
    brand: string;
    body: string;
    mono: string;
    hero: string;
    title: string;
    bodySize: string;
    caption: string;
  };
  spacing: {
    section: string;
    block: string;
    gap: string;
  };
  radius: {
    shell: string;
    panel: string;
    control: string;
    chip: string;
    badge: string;
    media: string;
    pill: string;
  };
  opacity: {
    glassStrong: string;
    glassSoft: string;
    glassLight: string;
    glassFaint: string;
    lineSoft: string;
    lineStrong: string;
    tintSoft: string;
    tintStrong: string;
    glowSoft: string;
    glowStrong: string;
    copySoft: string;
    copyStrong: string;
    highlight: string;
  };
  blur: {
    soft: string;
    strong: string;
  };
  shadow: {
    soft: string;
    floating: string;
    inset: string;
  };
  akePalette: {
    blue: string;
    blueDeep: string;
    indigo: string;
    orange: string;
    orangeDeep: string;
    cream: string;
    ink: string;
    mist: string;
  };
  layout: {
    maxWidth: string;
  };
  workbench: {
    columns: string;
    panelPadding: string;
    panelGap: string;
    sectionGap: string;
    inputSurface: string;
    settingsSurface: string;
    outputSurface: string;
    subpanelSurface: string;
  };
  drawer: {
    width: string;
    height: string;
    padding: string;
  };
  button: {
    glassPrimary: string;
    glassSecondary: string;
    glassGhost: string;
    hoverGlow: string;
  };
  surface: {
    panelTint: string;
    panelHighlight: string;
  };
}

export interface ThemePreset {
  name: string;
  label: string;
  tokens: ThemeTokens;
  surfaceStyles: {
    rainWash: string;
    pageGlow: string;
  };
}

export interface BackgroundPreset {
  id: string;
  label: string;
  imageSrc?: string;
  base: string;
  overlay: string;
  blur: string;
  brightness: string;
}
