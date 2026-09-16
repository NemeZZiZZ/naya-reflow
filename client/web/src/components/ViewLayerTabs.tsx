// Shared card-header pattern for the editor views: [Keyboard|Layout] tabs,
// [Layer 0..2] tabs, then a right-aligned slot for view-specific controls.
import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

export type EditorView = "kb" | "table";

export default function ViewLayerTabs({
  view,
  onView,
  layer,
  onLayer,
  children,
}: {
  view: EditorView;
  onView: (v: EditorView) => void;
  layer: number;
  onLayer: (l: number) => void;
  children?: ReactNode;
}) {
  return (
    <>
      <Tabs value={view} onValueChange={(v) => onView(v as EditorView)}>
        <TabsList>
          <TabsTrigger value="kb">Keyboard</TabsTrigger>
          <TabsTrigger value="table">Layout</TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs value={String(layer)} onValueChange={(v) => onLayer(parseInt(v, 10))}>
        <TabsList>
          <TabsTrigger value="0">Layer 0</TabsTrigger>
          <TabsTrigger value="1">Layer 1</TabsTrigger>
          <TabsTrigger value="2">Layer 2</TabsTrigger>
        </TabsList>
      </Tabs>
      <span className="ml-auto flex items-center gap-2">{children}</span>
    </>
  );
}
