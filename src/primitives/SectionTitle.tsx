import styles from "./SectionTitle.module.css";

interface SectionTitleProps {
  eyebrow?: string;
  title: string;
}

export function SectionTitle({ eyebrow, title }: SectionTitleProps) {
  return (
    <div className={styles.copy}>
      {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
      <h2 className={styles.title}>{title}</h2>
    </div>
  );
}
