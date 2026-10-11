let counter = 0;

/** Короткий уникальный id: `${prefix}_xxxxxxxx`. */
export function createId(prefix = "id"): string {
  counter = (counter + 1) % 1679616;
  const rnd =
    typeof crypto !== "undefined" && "getRandomValues" in crypto
      ? crypto.getRandomValues(new Uint32Array(1))[0].toString(36)
      : Math.floor(Math.random() * 0xffffffff).toString(36);
  return `${prefix}_${rnd}${counter.toString(36)}`;
}
