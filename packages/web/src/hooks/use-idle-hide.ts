import { useEffect, useState, useRef } from 'react';

/**
 * Returns true when the mouse/touch has moved recently, false after
 * `timeoutMs` of inactivity. Used to auto-hide UI overlays.
 */
export function useIdleHide(timeoutMs = 5000): boolean {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRef = useRef(true);

  useEffect(() => {
    const reset = () => {
      if (!visibleRef.current) {
        visibleRef.current = true;
        setVisible(true);
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        visibleRef.current = false;
        setVisible(false);
      }, timeoutMs);
    };

    // Start the timer immediately
    timerRef.current = setTimeout(() => setVisible(false), timeoutMs);

    window.addEventListener('mousemove', reset);
    window.addEventListener('mousedown', reset);
    window.addEventListener('touchstart', reset);
    window.addEventListener('touchmove', reset);

    return () => {
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('mousedown', reset);
      window.removeEventListener('touchstart', reset);
      window.removeEventListener('touchmove', reset);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timeoutMs]);

  return visible;
}
