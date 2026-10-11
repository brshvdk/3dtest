import { describe, expect, it } from "vitest";
import { splitLayout } from "../splitLayout";

// Размеры области видов (.stage__views) на типичных экранах.
describe("splitLayout — когда предлагать «План и 3D рядом»", () => {
  it("1440×900: друг под другом", () => expect(splitLayout(724, 795)).toBe("rows"));
  it("1920×1080: рядом", () => expect(splitLayout(1204, 975)).toBe("cols"));
  it("1280×800: места на два вида нет — только план", () => expect(splitLayout(564, 695)).toBeNull());
  it("1366×768: только план", () => expect(splitLayout(650, 663)).toBeNull());
  it("планшет 768×1024 (портрет): только план", () => expect(splitLayout(420, 919)).toBeNull());
  it("до измерения (0×0): только план", () => expect(splitLayout(0, 0)).toBeNull());
});
