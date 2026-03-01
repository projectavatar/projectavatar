/**
 * Hook to scan the props folder for available GLB prop models.
 * Fetches the file list from the dev server.
 */
import { useEffect, useState } from 'react';

export interface AvailableProp {
  /** Filename (e.g. keyboard.glb) */
  file: string;
  /** Derived id: filename without extension */
  id: string;
}

export function useScanProps(): AvailableProp[] {
  const [props, setProps] = useState<AvailableProp[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function scan() {
      try {
        const res = await fetch('/api/scan-props');
        if (!res.ok) return;
        const { files } = await res.json() as { files: string[] };
        if (cancelled) return;

        setProps(
          files.map(f => ({
            file: f,
            id: f.replace(/\.glb$/i, ''),
          })),
        );
      } catch {
        // Dev server might not be ready
      }
    }

    scan();
    const interval = setInterval(scan, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return props;
}
