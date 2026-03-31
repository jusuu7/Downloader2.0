import { Fragment, useLayoutEffect } from "react";
import type { PropsWithChildren } from "react";

import { createThemeVars } from "./createThemeVars";
import type { BackgroundPreset, ThemePreset } from "./types";

interface ThemeProviderProps extends PropsWithChildren {
  theme: ThemePreset;
  background: BackgroundPreset;
}

export function ThemeProvider({ theme, background, children }: ThemeProviderProps) {
  const themeVars = createThemeVars(theme, background);

  useLayoutEffect(() => {
    const rootStyle = document.documentElement.style;

    for (const [key, value] of Object.entries(themeVars)) {
      rootStyle.setProperty(key, value);
    }

    document.documentElement.dataset.theme = theme.name;
    document.documentElement.dataset.background = background.id;
  }, [background.id, theme.name, themeVars]);

  return <Fragment>{children}</Fragment>;
}
