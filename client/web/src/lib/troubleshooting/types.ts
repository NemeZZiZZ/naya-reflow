/* Troubleshooting plugin types.
 *
 * A problem is a TroubleEntry; its treatments are TroubleActions — either a
 * declarative wire recipe (steps) or a scripted run(ctx) for app-side flows.
 * All wire traffic goes through TroubleCtx.send, which refuses never-send
 * verbs at runtime (see wire-guard.ts). */

/** One guarded wire frame; delayMs settles after the step (default 350). */
export interface WireStep {
  t: number;
  c0: number;
  c1: number;
  params?: number[];
  delayMs?: number;
  /** advisory step: no-reply is logged, not fatal (default false) */
  tolerateNoReply?: boolean;
  /** human label for the log line */
  note?: string;
}

/** Runtime capabilities handed to scripted actions. */
export interface TroubleCtx {
  /** guarded wire send — throws on never-send verbs */
  send(t: number, c0: number, c1: number, params?: number[]): Promise<void>;
  confirm(msg: string): boolean;
  toast(msg: string, kind?: "success" | "info" | "error"): void;
  log(cls: "cdc" | "inf" | "err", msg: string): void;
  sleep(ms: number): Promise<void>;
  dump(): Promise<void>;
  refreshAux(): Promise<void>;
  reboot(): Promise<void>;
}

export interface TroubleAction {
  label: string;
  /** which half must be connected ('any' = app-side only) */
  side: "left" | "right" | "any";
  /** window.confirm text — required for anything that mutates device state */
  confirm?: string;
  /** declarative wire recipe (simple cases) — or run() for scripted ones */
  steps?: WireStep[];
  run?: (ctx: TroubleCtx) => Promise<void>;
}

export interface TroubleEntry {
  id: string;
  title: string;
  summary: string;
  details: string[];
  /** human recipe, numbered in the UI */
  steps: string[];
  actions?: TroubleAction[];
}
