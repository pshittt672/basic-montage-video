/** Charge la forme d'onde d'une chanson (calculée par FFmpeg, mise en cache). */

import { useEffect, useState } from "react";
import { waveform } from "../lib/backend";

export function useWaveform(path: string | undefined): Uint8Array | null {
  const [peaks, setPeaks] = useState<Uint8Array | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setPeaks(null);
    waveform(path)
      .then((p) => alive && setPeaks(p))
      .catch(() => alive && setPeaks(null));
    return () => {
      alive = false;
    };
  }, [path]);
  return peaks;
}
