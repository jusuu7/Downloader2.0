import type { ThemePreset } from "./types";

export const defaultTheme: ThemePreset = {
  name: "rainy-island",
  label: "雨雾岛屿",
  tokens: {
    colors: {
      canvas: "218 225 219",
      surface: "250 247 241",
      surfaceStrong: "231 239 232",
      surfaceGlass: "255 255 255",
      line: "138 152 143",
      lineStrong: "46 65 56",
      text: "28 39 33",
      textMuted: "92 103 94",
      primary: "49 92 73",
      primaryStrong: "30 56 45",
      accent: "193 108 91",
      accentSoft: "247 226 217",
      success: "77 128 97",
      warning: "180 138 72",
      danger: "165 91 84",
    },
    typography: {
      brand: "\"Source Han Serif SC\", \"Songti SC\", \"STSong\", \"PingFang SC\", serif",
      body: "\"Microsoft YaHei\", \"PingFang SC\", sans-serif",
      mono: "\"Consolas\", \"SFMono-Regular\", monospace",
      hero: "clamp(2.85rem, 5vw, 5.1rem)",
      title: "clamp(1.55rem, 2vw, 2.2rem)",
      bodySize: "1rem",
      caption: "0.84rem",
    },
    spacing: {
      section: "clamp(2rem, 4vw, 4rem)",
      block: "clamp(1.2rem, 2vw, 2rem)",
      gap: "0.9rem",
    },
    radius: {
      shell: "46px",
      panel: "34px",
      control: "24px",
      chip: "22px",
      badge: "18px",
      media: "26px",
      pill: "999px",
    },
    opacity: {
      glassStrong: "0.72",
      glassSoft: "0.5",
      glassLight: "0.34",
      glassFaint: "0.16",
      lineSoft: "0.18",
      lineStrong: "0.36",
      tintSoft: "0.18",
      tintStrong: "0.32",
      glowSoft: "0.24",
      glowStrong: "0.34",
      copySoft: "0.88",
      copyStrong: "0.96",
      highlight: "0.96",
    },
    blur: {
      soft: "14px",
      strong: "24px",
    },
    shadow: {
      soft: "0 24px 60px rgba(44, 61, 50, 0.14)",
      floating: "0 36px 110px rgba(31, 48, 38, 0.2)",
      inset: "inset 0 1px 0 rgba(255, 255, 255, 0.56)",
    },
    akePalette: {
      blue: "88 162 255",
      blueDeep: "61 93 227",
      indigo: "69 52 176",
      orange: "245 159 58",
      orangeDeep: "228 122 24",
      cream: "247 242 222",
      ink: "48 63 111",
      mist: "222 237 248",
    },
    layout: {
      maxWidth: "1220px",
    },
    workbench: {
      columns: "minmax(0, 1.02fr) minmax(22rem, 0.98fr)",
      panelPadding: "1.35rem",
      panelGap: "1rem",
      sectionGap: "1.1rem",
      inputSurface:
        "linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(246, 244, 238, 0.46)), radial-gradient(circle at 18% 18%, rgba(255, 241, 221, 0.5), transparent 34%), radial-gradient(circle at 78% 16%, rgba(194, 221, 206, 0.36), transparent 32%)",
      settingsSurface:
        "linear-gradient(180deg, rgba(255, 255, 255, 0.62), rgba(237, 244, 238, 0.42)), radial-gradient(circle at 84% 12%, rgba(193, 108, 91, 0.18), transparent 26%), radial-gradient(circle at 24% 84%, rgba(111, 153, 133, 0.18), transparent 28%)",
      outputSurface:
        "linear-gradient(180deg, rgba(255, 255, 255, 0.64), rgba(241, 246, 239, 0.42)), radial-gradient(circle at 72% 10%, rgba(196, 126, 108, 0.16), transparent 24%), radial-gradient(circle at 14% 82%, rgba(160, 196, 179, 0.22), transparent 26%)",
      subpanelSurface:
        "linear-gradient(180deg, rgba(255, 255, 255, 0.52), rgba(246, 244, 239, 0.28)), radial-gradient(circle at top left, rgba(255, 255, 255, 0.3), transparent 58%)",
    },
    drawer: {
      width: "min(32rem, calc(100vw - 1.5rem))",
      height: "min(82vh, 42rem)",
      padding: "1.35rem",
    },
    button: {
      glassPrimary:
        "linear-gradient(180deg, rgba(255, 255, 255, 0.38), rgba(255, 255, 255, 0.08)), linear-gradient(135deg, rgba(189, 107, 91, 0.2), rgba(85, 132, 109, 0.16))",
      glassSecondary:
        "linear-gradient(180deg, rgba(255, 255, 255, 0.32), rgba(255, 255, 255, 0.1)), linear-gradient(135deg, rgba(255, 236, 214, 0.26), rgba(170, 204, 188, 0.18))",
      glassGhost:
        "linear-gradient(180deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.04)), linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(255, 246, 228, 0.08))",
      hoverGlow: "0 0 32px rgba(193, 108, 91, 0.12), 0 0 22px rgba(85, 132, 109, 0.14)",
    },
    surface: {
      panelTint: "rgba(255, 248, 238, 0.12)",
      panelHighlight: "rgba(255, 255, 255, 0.28)",
    },
  },
  surfaceStyles: {
    rainWash:
      "radial-gradient(circle at 18% 26%, rgba(255, 230, 214, 0.24), transparent 28%), radial-gradient(circle at 82% 18%, rgba(204, 228, 214, 0.22), transparent 24%), radial-gradient(circle at 62% 72%, rgba(188, 208, 230, 0.16), transparent 22%), linear-gradient(145deg, rgba(52, 74, 62, 0.12), rgba(255,255,255,0.36) 40%, rgba(233, 240, 234, 0.46) 100%)",
    pageGlow:
      "radial-gradient(circle at 82% 10%, rgba(230, 170, 144, 0.26), transparent 18%), radial-gradient(circle at 14% 12%, rgba(255, 255, 255, 0.3), transparent 22%), radial-gradient(circle at 24% 86%, rgba(146, 184, 169, 0.18), transparent 18%)",
  },
};
