import { CHUNK_BYTES } from "../messages";
import type {
  InboundMeta,
  OutboundMeta,
  WebviewToHostMessage,
} from "../messages";
import { bytesToBase64, base64ToBytes } from "./engine/imageEngine";

let outSeq = 0;

/** Streams `bytes` to the host as an outbound base64 chunk sequence. */
export function streamOutbound(
  send: (msg: WebviewToHostMessage) => void,
  meta: OutboundMeta,
  bytes: Uint8Array,
): void {
  const id = ++outSeq;
  const total = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
  send({ type: "outBegin", data: { id, total, meta } });
  for (let i = 0; i < total; i++) {
    const slice = bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
    send({ type: "outChunk", data: { id, b64: bytesToBase64(slice) } });
  }
}

interface Pending {
  meta: InboundMeta;
  total: number;
  parts: Uint8Array[];
}

/** Reassembles inbound (host → webview) chunk streams keyed by stream id. */
export class InboundAssembler {
  private pending = new Map<number, Pending>();

  begin(id: number, total: number, meta: InboundMeta): void {
    this.pending.set(id, { meta, total, parts: [] });
  }

  /** Returns the assembled payload once the final chunk arrives, else null. */
  chunk(
    id: number,
    b64: string,
  ): { meta: InboundMeta; bytes: Uint8Array } | null {
    const entry = this.pending.get(id);
    if (!entry) {
      return null;
    }
    entry.parts.push(base64ToBytes(b64));
    if (entry.parts.length < entry.total) {
      return null;
    }
    this.pending.delete(id);
    return { meta: entry.meta, bytes: concat(entry.parts) };
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
