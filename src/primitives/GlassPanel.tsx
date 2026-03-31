import type { HTMLAttributes } from "react";

import { cx } from "../utils/cx";
import styles from "./GlassPanel.module.css";

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  tone?: "default" | "strong" | "tinted";
}

export function GlassPanel({
  tone = "default",
  className,
  children,
  ...props
}: GlassPanelProps) {
  return (
    <div className={cx(styles.panel, className)} data-tone={tone} {...props}>
      {children}
    </div>
  );
}
