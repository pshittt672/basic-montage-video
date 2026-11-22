/**
 * Glisser un clip de la bibliothèque vers la timeline.
 *
 * Le glisser-déposer HTML classique est désactivé dans Tauri sous Windows
 * (il sert au dépôt de fichiers depuis l'Explorateur). La bibliothèque
 * annonce donc elle-même le déplacement de la souris, et la timeline écoute.
 */

export interface LibraryDrag {
  mediaId: string;
  clientX: number;
  clientY: number;
  /** "move" pendant le glisser, "drop" au lâcher, "cancel" si abandon. */
  phase: "move" | "drop" | "cancel";
}

const EVENT = "library-drag";

export function emitLibraryDrag(detail: LibraryDrag): void {
  window.dispatchEvent(new CustomEvent<LibraryDrag>(EVENT, { detail }));
}

export function onLibraryDrag(cb: (d: LibraryDrag) => void): () => void {
  const listener = (e: Event) => cb((e as CustomEvent<LibraryDrag>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
