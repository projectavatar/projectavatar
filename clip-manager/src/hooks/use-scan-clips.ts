/**
 * Hook to scan the animations folder for unregistered FBX files.
 * Fetches the file list from the dev server and compares against clips.json.
 */
import { useEffect, useState } from 'react';
import type { ClipsJson } from '../types.ts';

export interface UnregisteredClip {
  file: string;
  /** Derived id: filename without extension */
  id: string;
}

export function useScanClips(data: ClipsJson): UnregisteredClip[] {
  const [unregistered, setUnregistered] = useState<UnregisteredClip[]>([]);
  const registeredFiles = Object.values(data.clips).map(c => c.file);

  useEffect(() => {
    let cancelled = false;

    async function scan() {
      try {
        const res = await fetch('/api/scan-clips');
        if (!res.ok) return;
        const { files } = await res.json() as { files: string[] };
        if (cancelled) return;

        const known = new Set(registeredFiles);
        const unknown = files
          .filter(f => !known.has(f))
          .map(f => ({
            file: f,
            id: f.replace(/\.fbx$/i, ''),
          }));

        setUnregistered(unknown);
      } catch {
        // Dev server might not be ready
      }
    }

    scan();
    // Re-scan periodically to pick up new files
    const interval = setInterval(scan, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [registeredFiles.join(',')]);

  return unregistered;
}
