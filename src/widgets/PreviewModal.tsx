import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ResultItem } from "../lib/downloader-api";
import styles from "./PreviewModal.module.css";

interface PreviewModalProps {
  item: ResultItem | null;
  items?: ResultItem[];
  onClose: () => void;
}

function wrapIndex(index: number, length: number) {
  if (!length) return 0;
  return (index + length) % length;
}

export function PreviewModal({ item, items = [], onClose }: PreviewModalProps) {
  const galleryItems = useMemo(() => {
    if (!item) return [];
    const imageItems = items.filter((entry) => entry.type === "image");
    if (imageItems.some((entry) => entry.fileId === item.fileId)) {
      return imageItems;
    }
    return [item, ...imageItems];
  }, [item, items]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const wheelLockRef = useRef(0);

  useEffect(() => {
    if (!item) return;
    const nextIndex = galleryItems.findIndex((entry) => entry.fileId === item.fileId);
    setCurrentIndex(nextIndex >= 0 ? nextIndex : 0);
  }, [galleryItems, item]);

  const currentItem = galleryItems[currentIndex] ?? item;
  const canNavigate = galleryItems.length > 1;

  const navigate = useCallback(
    (offset: number) => {
      if (!canNavigate) return;
      setCurrentIndex((index) => wrapIndex(index + offset, galleryItems.length));
    },
    [canNavigate, galleryItems.length],
  );

  useEffect(() => {
    if (!currentItem) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        navigate(1);
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        navigate(-1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentItem, navigate, onClose]);

  if (!item || !currentItem) return null;

  return (
    <div className={styles.overlay}>
      <button
        className={styles.backdrop}
        type="button"
        aria-label="关闭预览"
        onClick={onClose}
      />
      <div
        className={styles.stage}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchEnd={(event) => {
          if (!canNavigate || !touchStartRef.current) return;

          const touch = event.changedTouches[0];
          const deltaX = touch.clientX - touchStartRef.current.x;
          const deltaY = touch.clientY - touchStartRef.current.y;
          const absX = Math.abs(deltaX);
          const absY = Math.abs(deltaY);
          touchStartRef.current = null;

          if (Math.max(absX, absY) < 36) return;

          if (absX >= absY) {
            navigate(deltaX < 0 ? 1 : -1);
            return;
          }

          navigate(deltaY < 0 ? 1 : -1);
        }}
        onWheel={(event) => {
          if (!canNavigate) return;

          const now = Date.now();
          if (now - wheelLockRef.current < 260) return;

          const dominantDelta =
            Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

          if (Math.abs(dominantDelta) < 24) return;

          event.preventDefault();
          wheelLockRef.current = now;
          navigate(dominantDelta > 0 ? 1 : -1);
        }}
      >
        <div className={styles.mediaFrame} onClick={(event) => event.stopPropagation()}>
          <img className={styles.media} src={currentItem.mediaUrl} alt={currentItem.name} />
        </div>
      </div>
    </div>
  );
}
