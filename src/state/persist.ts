/**
 * Two kinds of persistence:
 *
 *  - localStorage, so a reload doesn't lose the list you just typed
 *  - the URL hash, so a list can be handed to someone else as a link
 *
 * The share payload is deflate-compressed where the platform offers it, since
 * a 200-name list is otherwise a very long URL.
 */

import { makeId } from '../data/parse.ts';
import { defaultSettings } from './store.ts';
import { LIMITS, type AppState, type Entry, type Settings } from '../types.ts';

const STORAGE_KEY = 'pc.v1';
const SHARE_PARAM = 'l';

/** Compact wire form: short keys, weight omitted when it's the default. */
interface WireEntry {
  n: string;
  w?: number;
  x?: 1;
}

interface WirePayload {
  v: 1;
  e: WireEntry[];
  s?: Partial<Settings>;
}

function toWire(entries: readonly Entry[], settings?: Settings): WirePayload {
  const payload: WirePayload = {
    v: 1,
    e: entries.map((entry) => {
      const wire: WireEntry = { n: entry.label };
      if (entry.weight !== 1) wire.w = entry.weight;
      if (entry.eliminated) wire.x = 1;
      return wire;
    }),
  };
  if (settings) payload.s = settings;
  return payload;
}

function fromWire(payload: unknown): { entries: Entry[]; settings: Partial<Settings> } | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Partial<WirePayload>;
  if (data.v !== 1 || !Array.isArray(data.e)) return null;

  const entries: Entry[] = [];
  for (const raw of data.e.slice(0, LIMITS.maxEntries)) {
    if (!raw || typeof raw !== 'object') continue;
    const wire = raw as WireEntry;
    if (typeof wire.n !== 'string' || wire.n.trim() === '') continue;
    entries.push({
      id: makeId(),
      label: wire.n.slice(0, LIMITS.maxLabel),
      weight: typeof wire.w === 'number' && Number.isFinite(wire.w) && wire.w > 0 ? wire.w : 1,
      eliminated: wire.x === 1,
    });
  }

  const s = data.s ?? {};
  const settings: Partial<Settings> = {};
  if (typeof s.count === 'number' && s.count >= 1) settings.count = Math.floor(s.count);
  if (typeof s.useWeights === 'boolean') settings.useWeights = s.useWeights;
  if (typeof s.eliminate === 'boolean') settings.eliminate = s.eliminate;
  if (typeof s.sound === 'boolean') settings.sound = s.sound;

  return { entries, settings };
}

/* ------------------------------------------------------------------ */
/* localStorage                                                        */
/* ------------------------------------------------------------------ */

export function saveLocal(state: AppState): void {
  try {
    const payload = toWire(state.entries, state.settings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private browsing, a full quota, or storage disabled entirely. Losing the
    // autosave is not worth breaking the page over.
  }
}

export function loadLocal(): { entries: Entry[]; settings: Settings } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = fromWire(JSON.parse(raw));
    if (!parsed || parsed.entries.length === 0) return null;
    return { entries: parsed.entries, settings: { ...defaultSettings(), ...parsed.settings } };
  } catch {
    return null;
  }
}

export function clearLocal(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* see saveLocal */
  }
}

/* ------------------------------------------------------------------ */
/* base64url + deflate                                                 */
/* ------------------------------------------------------------------ */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a long list can't blow the argument limit on String.fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function streamThrough(bytes: Uint8Array, stream: ReadableWritablePair): Promise<Uint8Array> {
  const source = new Blob([bytes as BlobPart]).stream() as ReadableStream<Uint8Array>;
  const response = new Response(source.pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

const hasCompression = (): boolean =>
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/**
 * Encoded payloads are prefixed so the decoder knows what it is looking at:
 * "1" for deflate-raw, "0" for plain JSON bytes on platforms without
 * CompressionStream (Safari before 16.4, older Firefox).
 */
export async function encodeShare(entries: readonly Entry[], settings?: Settings): Promise<string> {
  const json = JSON.stringify(toWire(entries, settings));
  const bytes = new TextEncoder().encode(json);

  if (hasCompression()) {
    try {
      const deflated = await streamThrough(bytes, new CompressionStream('deflate-raw'));
      return `1${bytesToBase64Url(deflated)}`;
    } catch {
      // Fall through to the uncompressed form.
    }
  }
  return `0${bytesToBase64Url(bytes)}`;
}

export async function decodeShare(
  encoded: string,
): Promise<{ entries: Entry[]; settings: Partial<Settings> } | null> {
  try {
    const flag = encoded[0];
    const body = encoded.slice(1);
    if (flag !== '0' && flag !== '1') return null;

    let bytes = base64UrlToBytes(body);
    if (flag === '1') {
      if (!hasCompression()) return null;
      bytes = await streamThrough(bytes, new DecompressionStream('deflate-raw'));
    }
    return fromWire(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* URL hash                                                            */
/* ------------------------------------------------------------------ */

export async function buildShareUrl(
  entries: readonly Entry[],
  settings: Settings,
  base = location.href,
): Promise<{ url: string; tooLong: boolean }> {
  const encoded = await encodeShare(entries, settings);
  const url = new URL(base);
  url.hash = `${SHARE_PARAM}=${encoded}`;
  const href = url.toString();
  return { url: href, tooLong: href.length > LIMITS.maxShareUrl };
}

/** Read and consume a shared list from the current URL hash. */
export async function readShareUrl(
  hash = location.hash,
): Promise<{ entries: Entry[]; settings: Partial<Settings> } | null> {
  const match = new RegExp(`(?:^#|&)${SHARE_PARAM}=([^&]+)`).exec(hash);
  if (!match?.[1]) return null;
  return decodeShare(match[1]);
}
