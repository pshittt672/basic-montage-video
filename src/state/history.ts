/**
 * Historique pour « Annuler / Rétablir ».
 *
 * On garde simplement les versions précédentes (`past`) et suivantes
 * (`future`) du projet. Comme le projet n'est jamais modifié sur place,
 * chaque version est une photo fidèle.
 */

import type { Project } from "../model/project";

const MAX_STEPS = 200;

export interface History {
  past: Project[];
  present: Project;
  future: Project[];
  /** Version avant un geste en cours (ex. glisser une poignée de rognage). */
  gestureStart: Project | null;
  /** true si le projet a changé depuis le dernier enregistrement. */
  dirty: boolean;
}

export type HistoryAction =
  /** Une modification normale, qui peut être annulée. */
  | { type: "apply"; change: (p: Project) => Project }
  /** Début d'un geste : les mises à jour suivantes ne compteront qu'une fois. */
  | { type: "gestureStart" }
  | { type: "gestureUpdate"; change: (p: Project) => Project }
  | { type: "gestureEnd" }
  | { type: "undo" }
  | { type: "redo" }
  /** Remplace tout (nouveau projet ou projet ouvert) et vide l'historique. */
  | { type: "load"; project: Project }
  | { type: "saved" };

export function initHistory(project: Project): History {
  return { past: [], present: project, future: [], gestureStart: null, dirty: false };
}

function push(h: History, before: Project, after: Project): History {
  if (after === before) return { ...h, present: after };
  return {
    ...h,
    past: [...h.past, before].slice(-MAX_STEPS),
    present: after,
    future: [],
    dirty: true,
  };
}

export function historyReducer(h: History, action: HistoryAction): History {
  switch (action.type) {
    case "apply":
      return push(h, h.present, action.change(h.present));
    case "gestureStart":
      return { ...h, gestureStart: h.present };
    case "gestureUpdate":
      // Sans geste en cours (ex. réglage au clavier), c'est une modification normale.
      if (!h.gestureStart) return push(h, h.present, action.change(h.present));
      return { ...h, present: action.change(h.present) };
    case "gestureEnd": {
      if (!h.gestureStart) return h;
      return { ...push(h, h.gestureStart, h.present), gestureStart: null };
    }
    case "undo": {
      if (h.past.length === 0) return h;
      const previous = h.past[h.past.length - 1];
      return {
        ...h,
        past: h.past.slice(0, -1),
        present: previous,
        future: [h.present, ...h.future],
        dirty: true,
      };
    }
    case "redo": {
      if (h.future.length === 0) return h;
      const [next, ...rest] = h.future;
      return { ...h, past: [...h.past, h.present], present: next, future: rest, dirty: true };
    }
    case "load":
      return initHistory(action.project);
    case "saved":
      return { ...h, dirty: false };
  }
}
