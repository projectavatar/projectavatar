import { useEffect, useState, useRef } from 'react';

/**
 * Returns true when the mouse has moved recently, false after
 * `timeoutMs` of inactivity. Used to auto-hide UI overlays.
 */
export function useIdleHide(timeoutMs = 5000): boolean {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const reset = () => {
      setVisible(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setVisible(false), timeoutMs);
    };

    // Start the timer immediately
    timerRef.current = setTimeout(() => setVisible(false), timeoutMs);

    window.addEventListener('mousemove', reset);
    window.addEventListener('mousedown', reset);

    return () => {
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('mousedown', reset);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timeoutMs]);

  return visible;
}
