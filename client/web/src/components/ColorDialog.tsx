// Custom-color dialog: HexColorPicker + linked H/S slider+input rows,
// adds the result to the persisted custom palette.
import { HexColorPicker } from "react-colorful";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Slider } from "./ui/slider";
import { hexToHs, hsToHex } from "../lib/naya";
import type { HsColor } from "../hooks/useCustomColors";

export default function ColorDialog({
  open,
  onOpenChange,
  color,
  onColor,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  color: HsColor;
  onColor: (c: HsColor) => void;
  onAdd: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Custom color</DialogTitle>
        <DialogDescription>
          Pick a color, fine-tune H/S, then add it to the palette.
        </DialogDescription>
        <HexColorPicker
          style={{ width: "100%", height: 140 }}
          color={hsToHex(color.h, color.s)}
          onChange={(hex) => {
            const hs = hexToHs(hex);
            if (hs) onColor({ h: hs.h, s: hs.s });
          }}
        />
        <div className="flex items-center gap-2">
          <span className="w-4 font-mono text-xs">H</span>
          <Slider
            min={0}
            max={511}
            step={1}
            value={[color.h]}
            onValueChange={([v]) => onColor({ ...color, h: v })}
            className="flex-1"
          />
          <Input
            type="number"
            min={0}
            max={511}
            value={color.h}
            onChange={(e) =>
              onColor({
                ...color,
                h: Math.min(511, Math.max(0, parseInt(e.target.value, 10) || 0)),
              })
            }
            className="w-20"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 font-mono text-xs">S</span>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[color.s]}
            onValueChange={([v]) => onColor({ ...color, s: v })}
            className="flex-1"
          />
          <Input
            type="number"
            min={0}
            max={100}
            value={color.s}
            onChange={(e) =>
              onColor({
                ...color,
                s: Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)),
              })
            }
            className="w-20"
          />
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-6 w-6 rounded border border-border"
            style={{ background: hsToHex(color.h, color.s) }}
          />
          <span className="font-mono text-xs">
            H{color.h} S{color.s}
          </span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onAdd}>Add color</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
