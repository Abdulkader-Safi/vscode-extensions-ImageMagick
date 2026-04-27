import { vscode } from "./vscodeApi";
import type { HostToWebviewMessage, WebviewToHostMessage } from "../messages";

export function send(msg: WebviewToHostMessage): void {
  vscode.postMessage(msg);
}

export type HostListener = (msg: HostToWebviewMessage) => void;

export function onHostMessage(listener: HostListener): () => void {
  const handler = (event: MessageEvent): void => {
    listener(event.data as HostToWebviewMessage);
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}
