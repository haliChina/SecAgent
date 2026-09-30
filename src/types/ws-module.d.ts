/**
 * Minimal structural typing for the `ws` package.
 *
 * The project talks to DashScope WebSockets with an Authorization handshake
 * header, which the Node global WebSocket cannot send — only the `ws` package
 * can. Only the members actually used are declared here; `ws` also ships rich
 * typings via @types/ws if full coverage is ever needed.
 */
declare module "ws" {
  import type { EventEmitter } from "node:events";

  export interface WsMessageEvent {
    data: Buffer | ArrayBuffer | Buffer[];
    type: string;
    target: WebSocket;
  }

  export default class WebSocket extends EventEmitter {
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSING: 2;
    static readonly CLOSED: 3;
    readonly CONNECTING: 0;
    readonly OPEN: 1;
    readonly CLOSING: 2;
    readonly CLOSED: 3;
    readyState: 0 | 1 | 2 | 3;
    binaryType: "nodebuffer" | "arraybuffer" | "fragments";
    onopen: ((event: unknown) => void) | null;
    onclose: ((event: { code?: number; reason?: string }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onmessage: ((event: WsMessageEvent) => void) | null;
    constructor(address: string, options?: { headers?: Record<string, string>; handshakeTimeout?: number });
    send(data: unknown, options?: { binary?: boolean; fin?: boolean }, callback?: (error?: Error) => void): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
  }
}
