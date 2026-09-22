/* URL-as-editor-state (UHK Agent pattern): tab/view/layer live in the query
 * string — shareable views, updated via replaceState (no history spam).
 * Selecting exactly one key pushes a `key` entry, so the browser Back
 * button closes the selection panel; Back to a key-less URL clears the
 * selection. All effects are no-ops outside a browser (node smoke). */
import { useEffect } from "react";
import type { AppTab } from "../components/AppTabs";
import type { EditorView } from "../components/ViewLayerTabs";
import type { SelKey } from "../lib/queue";

const TABS: readonly string[] = [
  "bindings",
  "led",
  "modules",
  "behavior",
  "devices",
];

export interface UrlInit {
  tab: AppTab;
  view: EditorView;
  layer: number;
  selKey?: SelKey;
}

export function initialUrlState(): UrlInit {
  const init: UrlInit = { tab: "bindings", view: "kb", layer: 0 };
  if (typeof window === "undefined") return init;
  const p = new URLSearchParams(window.location.search);
  const tab = p.get("tab");
  if (tab && TABS.includes(tab)) init.tab = tab as AppTab;
  const view = p.get("view");
  if (view === "kb" || view === "table") init.view = view;
  const layer = Number(p.get("layer"));
  if (Number.isInteger(layer) && layer >= 0 && layer <= 2) init.layer = layer;
  const key = Number(p.get("key"));
  if (Number.isInteger(key) && key >= 0 && key <= 135)
    init.selKey = { layer: init.layer, kk: key };
  return init;
}

export function useUrlSync({
  tab,
  view,
  layer,
  sel,
  setSel,
  clearSelection,
}: {
  tab: AppTab;
  view: EditorView;
  layer: number;
  sel: SelKey[];
  setSel: (s: SelKey[]) => void;
  clearSelection: () => void;
}): void {
  // viewed state -> URL (replaceState: shareable, no history entries)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const setp = (name: string, val: string, def: string) => {
      if (val === def) url.searchParams.delete(name);
      else url.searchParams.set(name, val);
    };
    setp("tab", tab, "bindings");
    setp("view", view, "kb");
    setp("layer", String(layer), "0");
    window.history.replaceState({}, "", url);
  }, [tab, view, layer]);

  // single-key selection -> pushState (Back closes the panel)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const cur = url.searchParams.get("key");
    if (sel.length === 1) {
      const kk = sel[0].kk;
      if (cur !== String(kk)) {
        url.searchParams.set("key", String(kk));
        window.history.pushState({}, "", url);
      }
    } else if (cur !== null) {
      url.searchParams.delete("key");
      window.history.replaceState({}, "", url);
    }
  }, [sel]);

  // Back/Forward: re-read the key param (absent -> close the panel)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const p = new URLSearchParams(window.location.search);
      const k = p.get("key");
      if (k === null) clearSelection();
      else {
        const kk = Number(k);
        if (Number.isInteger(kk) && kk >= 0 && kk <= 135)
          setSel([{ layer, kk }]);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [layer, setSel, clearSelection]);
}
