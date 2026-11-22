import { describe, expect, it } from "vitest";
import {
  buildExportPlan,
  clipAt,
  emptyProject,
  formatTime,
  insertClip,
  moveClip,
  parseProject,
  serializeProject,
  setAllMuted,
  setMusic,
  splitAt,
  suggestExportSettings,
  totalDuration,
  trimClip,
  type MediaItem,
  type Project,
} from "./project";

function video(id: string, duration = 10, extra: Partial<MediaItem> = {}): MediaItem {
  return { id, path: `C:/clips/${id}.mp4`, name: `${id}.mp4`, kind: "video", duration, hasAudio: true, ...extra };
}

function withClips(...media: MediaItem[]): Project {
  let p: Project = { ...emptyProject(), media };
  for (const m of media) p = insertClip(p, m);
  return p;
}

describe("timeline", () => {
  it("met les clips bout à bout, son coupé par défaut", () => {
    const p = withClips(video("a"), video("b", 5));
    expect(totalDuration(p)).toBe(15);
    expect(p.clips.every((c) => c.muted)).toBe(true);
    expect(clipAt(p, 12)?.index).toBe(1);
    expect(clipAt(p, 15)).toBeNull();
  });

  it("rogne sans dépasser le fichier source", () => {
    let p = withClips(video("a"));
    const id = p.clips[0].id;
    p = trimClip(p, id, { inPoint: 2, outPoint: 50 });
    expect(p.clips[0]).toMatchObject({ inPoint: 2, outPoint: 10 });
    p = trimClip(p, id, { inPoint: 9.99 });
    expect(p.clips[0].outPoint - p.clips[0].inPoint).toBeCloseTo(0.1);
  });

  it("coupe un clip en deux à la position du curseur", () => {
    let p = withClips(video("a"), video("b"));
    p = splitAt(p, 13);
    expect(p.clips).toHaveLength(3);
    expect(p.clips[1]).toMatchObject({ mediaId: "b", inPoint: 0, outPoint: 3 });
    expect(p.clips[2]).toMatchObject({ mediaId: "b", inPoint: 3, outPoint: 10 });
    expect(totalDuration(p)).toBe(20);
    // Trop près d'un bord : rien ne change.
    expect(splitAt(p, 13.01)).toBe(p);
  });

  it("réordonne les clips", () => {
    let p = withClips(video("a"), video("b"), video("c"));
    p = moveClip(p, p.clips[0].id, 2);
    expect(p.clips.map((c) => c.mediaId)).toEqual(["b", "c", "a"]);
  });

  it("coupe ou remet le son de tous les clips", () => {
    const p = setAllMuted(withClips(video("a"), video("b")), false);
    expect(p.clips.some((c) => c.muted)).toBe(false);
  });
});

describe("export", () => {
  it("prépare le plan pour FFmpeg", () => {
    let p = withClips(video("a"), video("b", 10, { hasAudio: false }));
    p = setAllMuted(p, false);
    const song: MediaItem = { ...video("song", 200), kind: "audio", path: "C:/song.mp3" };
    p = setMusic({ ...p, media: [...p.media, song] }, "song");
    const plan = buildExportPlan(p, "C:/out.mp4");
    expect(plan.segments.map((s) => s.keepAudio)).toEqual([true, false]);
    expect(plan.music).toMatchObject({ path: "C:/song.mp3", start: 0 });
    // Une chanson posée après la fin de la vidéo n'est pas exportée.
    expect(buildExportPlan(setMusic(p, "song", 25), "C:/out.mp4").music).toBeNull();
    expect([plan.width, plan.height]).toEqual([1920, 1080]);
  });

  it("devine l'orientation et la cadence des clips", () => {
    const p = withClips(
      video("a", 10, { width: 512, height: 768, fps: 24 }),
      video("b", 10, { width: 512, height: 768, fps: 23.976 }),
      video("c", 10, { width: 512, height: 768, fps: 30 }),
    );
    expect(suggestExportSettings(p)).toMatchObject({ orientation: "portrait", fps: 24 });
  });
});

describe("enregistrement", () => {
  it("relit un projet enregistré", () => {
    const p = withClips(video("a"));
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it("refuse un fichier qui n'est pas un projet", () => {
    expect(() => parseProject("{}")).toThrow();
    expect(() => parseProject("pas du json")).toThrow();
  });
});

it("affiche les durées", () => {
  expect(formatTime(65.34)).toBe("1:05.3");
  expect(formatTime(3)).toBe("0:03.0");
});
