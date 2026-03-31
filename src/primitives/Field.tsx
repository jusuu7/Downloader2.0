import type { InputHTMLAttributes } from "react";

import { cx } from "../utils/cx";
import styles from "./Field.module.css";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function Field({ label, hint, className, ...props }: FieldProps) {
  return (
    <label className={cx(styles.field, className)}>
      <span className={styles.label}>{label}</span>
      <input className={styles.input} {...props} />
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </label>
  );
}
