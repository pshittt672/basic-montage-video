/** Affiche la vignette d'une vidéo (fabriquée par FFmpeg, mise en cache). */

import { useEffect, useState } from "react";
import { thumbnailUrl } from "../lib/backend";

export function useThumbnail(path: string | undefined, at = 0.5): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    thumbnailUrl(path, at)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [path, at]);
  return url;
}

export function Thumb({ path, at }: { path: string; at?: number }) {
  const url = useThumbnail(path, at);
  return url ? <img className="thumb" src={url} alt="" draggable={false} /> : <div className="thumb empty" />;
}
