import type { ButtonHTMLAttributes } from "react";

import { cx } from "../utils/cx";
import styles from "./RoundButton.module.css";

interface RoundButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "primary" | "secondary" | "ghost";
}

export function RoundButton({
  tone = "primary",
  className,
  children,
  type = "button",
  ...props
}: RoundButtonProps) {
  return (
    <button className={cx(styles.button, className)} data-tone={tone} type={type} {...props}>
      <span>{children}</span>
    </button>
  );
}
