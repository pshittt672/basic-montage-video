import { expect, it } from "vitest";
import { emptyProject, updateMusic, type Project } from "../model/project";
import { historyReducer, initHistory } from "./history";

const rename = (p: Project): Project => ({ ...p, muteOnImport: !p.muteOnImport });

it("annule et rétablit", () => {
  let h = initHistory(emptyProject());
  h = historyReducer(h, { type: "apply", change: rename });
  expect(h.present.muteOnImport).toBe(false);
  h = historyReducer(h, { type: "undo" });
  expect(h.present.muteOnImport).toBe(true);
  h = historyReducer(h, { type: "redo" });
  expect(h.present.muteOnImport).toBe(false);
});

it("compte un geste continu comme une seule étape", () => {
  const start: Project = { ...emptyProject(), music: { mediaId: "m", volume: 1, fadeIn: 0, fadeOut: 0 } };
  let h = initHistory(start);
  h = historyReducer(h, { type: "gestureStart" });
  for (const v of [0.9, 0.8, 0.7]) {
    h = historyReducer(h, { type: "gestureUpdate", change: (p) => updateMusic(p, { volume: v }) });
  }
  h = historyReducer(h, { type: "gestureEnd" });
  expect(h.past).toHaveLength(1);
  h = historyReducer(h, { type: "undo" });
  expect(h.present.music?.volume).toBe(1);
});

it("ignore une modification qui ne change rien", () => {
  let h = initHistory(emptyProject());
  h = historyReducer(h, { type: "apply", change: (p) => p });
  expect(h.past).toHaveLength(0);
  expect(h.dirty).toBe(false);
});
