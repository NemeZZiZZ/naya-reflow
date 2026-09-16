// Keyboard view card: view/layer tabs + refresh/save/LED-toggle header,
// the fit-scaled keyboard, and the usage hint.
import { RefreshCw } from "lucide-react";
import Keyboard from "./Keyboard";
import ViewLayerTabs from "./ViewLayerTabs";
import type { EditorView } from "./ViewLayerTabs";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import type { ReactNode } from "react";

export default function KeyboardCard({
  view,
  onView,
  layer,
  onLayer,
  leftOn,
  onDump,
  saveMenu,
  ledMode,
  onLedMode,
  kbBoxRef,
  kbStageRef,
  kbScale,
  keymap,
  ledmap,
  selKks,
  onSelect,
  dirtyKks,
}: {
  view: EditorView;
  onView: (v: EditorView) => void;
  layer: number;
  onLayer: (l: number) => void;
  leftOn: boolean;
  onDump: () => void;
  saveMenu: ReactNode;
  ledMode: boolean;
  onLedMode: (v: boolean) => void;
  kbBoxRef: React.RefObject<HTMLDivElement | null>;
  kbStageRef: React.RefObject<HTMLDivElement | null>;
  kbScale: number;
  keymap: Map<number, Uint8Array>;
  ledmap: Map<number, { h: number; s: number }>;
  selKks: Set<number>;
  onSelect: (pos: number, kk: number, additive: boolean, allLayers: boolean) => void;
  dirtyKks: Set<number>;
}) {
  return (
    <Card className="mb-3">
      <CardHeader className="flex-wrap">
        <ViewLayerTabs view={view} onView={onView} layer={layer} onLayer={onLayer}>
          <Button
            variant="secondary"
            size="sm"
            title="Re-read all layers + LED maps from the LEFT half"
            onClick={onDump}
            disabled={!leftOn}
          >
            <RefreshCw /> Refresh
          </Button>
          {saveMenu}
          <Checkbox
            id="ledmode"
            checked={ledMode}
            onCheckedChange={(v) => onLedMode(v === true)}
          />
          <Label htmlFor="ledmode">LED colors on keys</Label>
        </ViewLayerTabs>
      </CardHeader>
      <CardContent>
        <div
          className="overflow-hidden rounded-sm bg-background p-4 min-h-60"
          ref={kbBoxRef}
        >
          <div
            ref={kbStageRef}
            className="mx-auto max-w-full"
            style={{ width: "fit-content", zoom: kbScale }}
          >
            <Keyboard
              keymap={keymap}
              ledmap={ledmap}
              ledMode={ledMode}
              sel={selKks}
              onSelect={onSelect}
              disabled={!leftOn}
              dirty={dirtyKks}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {leftOn
            ? "Click a key to select it, Shift+click for multi-select, Alt+click selects the key on all layers. Assign an action and/or a color in the panel below — changes queue up, nothing writes until Flash."
            : "Connect the LEFT half — legends and colors load automatically."}
        </p>
      </CardContent>
    </Card>
  );
}
