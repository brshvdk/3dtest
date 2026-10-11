import { describe, expect, it } from "vitest";
import { addOpening } from "../roomEdit";
import { createDemoProject, createRoom } from "../project";
import { buildShareUrl, decodeProject, encodeProject, readShareHash } from "../share";

describe("share", () => {
  it("encode → decode возвращает тот же проект", async () => {
    const p = createDemoProject();
    const enc = await encodeProject(p);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/); // сжатый base64url, без префикса
    expect(await decodeProject(enc)).toEqual(p);
  });

  it("сжатие заметно уменьшает ссылку", async () => {
    const p = createDemoProject();
    let room = createRoom({ name: "Спальня", shape: "L" });
    for (let i = 0; i < 4; i++) room = addOpening(room, "door").room;
    p.rooms.push(room);
    const enc = await encodeProject(p);
    expect(enc.length).toBeLessThan(JSON.stringify(p).length * 0.6);
    expect(await decodeProject(enc)).toEqual(p);
  });

  it("принимает строку с #p= и несжатый формат", async () => {
    const p = createDemoProject();
    const enc = await encodeProject(p);
    expect(await decodeProject(`#p=${enc}`)).toEqual(p);
    const bytes = new TextEncoder().encode(JSON.stringify(p));
    const b64 = btoa(String.fromCharCode(...bytes));
    const raw = "j." + b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await decodeProject(raw)).toEqual(p);
  });

  it("мусор → null", async () => {
    expect(await decodeProject("")).toBeNull();
    expect(await decodeProject("!!!")).toBeNull();
    expect(await decodeProject("AAAAAAAA")).toBeNull();
    expect(await decodeProject("j.e30")).toBeNull(); // {} — не проект
    expect(await decodeProject("j." + btoa("not json"))).toBeNull();
  });

  it("ссылка и hash без window", () => {
    expect(buildShareUrl("abc")).toBe("#p=abc");
    expect(readShareHash()).toBeNull();
  });
});
