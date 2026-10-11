/**
 * Ссылка на проект: Project → JSON → deflate-raw → base64url в hash URL.
 * Без CompressionStream — JSON без сжатия с префиксом RAW_PREFIX.
 * Декодирование защищено: лимиты размера, try/catch, migrateProject.
 */
import { migrateProject } from "./project";
import type { Project } from "./types";

/** Префикс несжатого формата ('.' не входит в алфавит base64url). */
const RAW_PREFIX = "j.";
/** Параметр hash: `#p=…`. */
const HASH_PARAM = "p";
/** Лимиты: длина строки в ссылке и размер распакованного JSON (защита от «zip-бомб»). */
const MAX_ENCODED_LENGTH = 1_000_000;
const MAX_DECODED_BYTES = 5_000_000;

type Bytes = Uint8Array<ArrayBuffer>;

function toBase64Url(bytes: Bytes): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Bytes {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Прогоняет байты через (De)CompressionStream с ограничением размера результата. */
async function transformBytes(
  input: Bytes,
  stream: { readable: ReadableStream<Bytes>; writable: WritableStream<BufferSource> },
  limit = Infinity,
): Promise<Bytes> {
  const writer = stream.writable.getWriter();
  // Пишем параллельно с чтением, иначе можно упереться в backpressure.
  const writing = writer.write(input).then(() => writer.close());
  writing.catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Bytes[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error("Слишком большой проект");
    }
    chunks.push(value);
  }
  await writing;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

export async function encodeProject(p: Project): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  if (typeof CompressionStream !== "undefined") {
    try {
      return toBase64Url(await transformBytes(bytes, new CompressionStream("deflate-raw")));
    } catch {
      // Падаем на несжатый формат ниже.
    }
  }
  return RAW_PREFIX + toBase64Url(bytes);
}

/** Строка из ссылки (можно целиком `#p=…`) → проект или null. */
export async function decodeProject(s: string): Promise<Project | null> {
  try {
    let str = s.trim();
    if (str.startsWith("#")) str = str.slice(1);
    if (str.startsWith(`${HASH_PARAM}=`)) str = str.slice(HASH_PARAM.length + 1);
    if (!str || str.length > MAX_ENCODED_LENGTH) return null;
    let bytes: Bytes;
    if (str.startsWith(RAW_PREFIX)) {
      bytes = fromBase64Url(str.slice(RAW_PREFIX.length));
    } else {
      if (typeof DecompressionStream === "undefined") return null;
      bytes = await transformBytes(fromBase64Url(str), new DecompressionStream("deflate-raw"), MAX_DECODED_BYTES);
    }
    if (bytes.length > MAX_DECODED_BYTES) return null;
    return migrateProject(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

const hasLocation = (): boolean => typeof window !== "undefined" && typeof window.location !== "undefined";

export function buildShareUrl(encoded: string): string {
  const base = hasLocation() ? `${window.location.origin}${window.location.pathname}` : "";
  return `${base}#${HASH_PARAM}=${encoded}`;
}

/** Закодированный проект из location.hash или null. */
export function readShareHash(): string | null {
  if (!hasLocation()) return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const value = new URLSearchParams(hash).get(HASH_PARAM);
  return value ? value : null;
}

/** Убирает проект из адресной строки, не перезагружая страницу. */
export function clearShareHash(): void {
  if (!hasLocation() || !window.location.hash) return;
  try {
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, "", `${pathname}${search}`);
  } catch {
    window.location.hash = "";
  }
}
