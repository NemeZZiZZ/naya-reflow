// LED Map tab: Brush/Fill/Pipette paint tools, H/S sliders, custom colors,
// and per-layer animations (plain actions — the device has no GET, so the
// active animation is unknown).
import { useState } from 'react';
import { Brush, PaintBucket, Pipette, Plus, type LucideIcon } from 'lucide-react';
import Keyboard, { type LedVal } from '../Keyboard';
import ColorDialog from '../ColorDialog';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader } from '../ui/card';
import type { Draft } from '../../lib/draft';
import type { LedRec } from '../../lib/naya';
import { hsToHex, ledCss } from '../../lib/naya';import { ANIM_NAMES, animOp } from '../../lib/settings';
import { queueColor, queueFillLayer } from '../../lib/queue';
import type { HsColor } from '../../hooks/useCustomColors';
import type { LogFn } from '../../hooks/useLog';
import { cn } from '../../lib/utils';

type LedTool = 'brush' | 'fill' | 'pipette';

const TOOLS: { id: LedTool; label: string; Icon: LucideIcon; hint: string }[] = [
  { id: 'brush', label: 'Brush', Icon: Brush, hint: 'Paint one key per click' },
  { id: 'fill', label: 'Fill', Icon: PaintBucket, hint: 'Paint the whole layer (ignores the clicked key)' },
  { id: 'pipette', label: 'Pipette', Icon: Pipette, hint: 'Pick the clicked key color, queues nothing' },
];

// Device hue is 9-bit (0..511, shared with the custom palette + ColorDialog);
// saturation 0..100. No Value channel — brightness is keyboard-wide.
const HUE_MAX = 511;

const NO_SEL = new Set<number>();

export default function LedTab({
  layer,
  onLayer,
  keymap,
  ledsByLayer,
  ledmap,
  dirtyKks,
  draftRef,
  bumpDraft,
  log,
  leftOn,
  customColors,
  onSaveCustomColors,
}: {
  layer: number;
  onLayer: (l: number) => void;
  keymap: Map<number, Uint8Array>;
  ledsByLayer: LedRec[][];
  ledmap: Map<number, LedVal>;
  dirtyKks: Set<number>;
  draftRef: { current: Draft };
  bumpDraft: () => void;
  log: LogFn;
  leftOn: boolean;
  customColors: HsColor[];
  onSaveCustomColors: (cs: HsColor[]) => void;
}) {
  const [tool, setTool] = useState<LedTool>('brush');
  const [color, setColor] = useState<HsColor>({ h: 180, s: 100 });
  const [dlgOpen, setDlgOpen] = useState(false);
  const [dlgColor, setDlgColor] = useState<HsColor>({ h: 180, s: 100 });

  const leds = ledsByLayer[layer] ?? [];

  function toolClick(_pos: number, kk: number) {
    if (!leftOn) return;
    if (tool === 'pipette') {
      const cur = ledmap.get(kk);
      if (cur) {
        setColor({ h: cur.h, s: cur.s });
        log('inf', `pipette KK ${kk} (0x${kk.toString(16)}) → H${cur.h} S${cur.s}`);
      } else {
        log('inf', `pipette KK ${kk} (0x${kk.toString(16)}): no LED there`);
      }
      return;
    }
    if (tool === 'fill') {
      const n = queueFillLayer(draftRef.current, layer, leds, color);
      bumpDraft();
      log('inf', `queued fill: ${n} LEDs L${layer} → H${color.h}/S${color.s}`);
      return;
    }
    const { queued } = queueColor(draftRef.current, [{ layer, kk }], color);
    bumpDraft();
    if (queued)
      log('inf', `queued color L${layer} KK ${kk} → H${color.h}/S${color.s}`);
    else log('err', `KK ${kk} (0x${kk.toString(16)}) has no LED — skipped`);
  }

  function queueAnim(i: number) {
    draftRef.current.add(animOp(layer, i));
    bumpDraft();
    log('inf', `queued animation L${layer} → ${ANIM_NAMES[i]}`);
  }

  function addCustomColor() {
    const c = { h: dlgColor.h, s: dlgColor.s };
    if (!customColors.some((x) => x.h === c.h && x.s === c.s))
      onSaveCustomColors([...customColors, c]);
    setColor(c);
    setDlgOpen(false);
  }

  return (
    <div className="flex gap-4 items-start">
      <div className="flex-1 min-w-0">
        <Card className="mb-3">
          <CardHeader className="flex-wrap">
            <div className="flex items-center gap-1" role="tablist" aria-label="Layer">
              {[0, 1, 2].map((l) => (
                <Button
                  key={l}
                  variant={l === layer ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onLayer(l)}
                >
                  L{l}
                </Button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {leds.length} LEDs on L{layer}
            </span>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-sm bg-background p-4 min-h-60">
              <Keyboard
                keymap={keymap}
                ledmap={ledmap}
                ledMode
                sel={NO_SEL}
                onSelect={toolClick}
                disabled={!leftOn}
                dirty={dirtyKks}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {leftOn
                ? 'Click a key to apply the tool — changes queue up, nothing writes until Flash.'
                : 'Connect the LEFT half — colors load automatically.'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="w-80 shrink-0 flex flex-col gap-3">
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4">
            <div className="text-xs font-medium text-muted-foreground">Tool</div>
            <div className="flex gap-1">
              {TOOLS.map(({ id, label, Icon, hint }) => (
                <Button
                  key={id}
                  variant={tool === id ? 'default' : 'outline'}
                  size="sm"
                  title={hint}
                  onClick={() => setTool(id)}
                  className="flex-1"
                >
                  <Icon /> {label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-6 w-6 shrink-0 rounded border border-border"
                style={{ background: ledCss(color.h, color.s) }}
                title="current tool color"
              />
              <span className="font-mono text-xs">
                H{color.h} S{color.s} {hsToHex(color.h, color.s)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 font-mono text-xs">H</span>
              <input
                type="range"
                min={0}
                max={HUE_MAX}
                step={1}
                value={color.h}
                onChange={(e) => setColor({ ...color, h: Number(e.target.value) })}
                className="flex-1"
                style={{ accentColor: 'var(--primary)' }}
                aria-label="Hue (device 0–511)"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 font-mono text-xs">S</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={color.s}
                onChange={(e) => setColor({ ...color, s: Number(e.target.value) })}
                className="flex-1"
                style={{ accentColor: 'var(--primary)' }}
                aria-label="Saturation"
              />
            </div>
            {customColors.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {customColors.map((c, i) => (
                  <button
                    key={`${c.h}-${c.s}-${i}`}
                    type="button"
                    title={`H${c.h} S${c.s}`}
                    onClick={() => setColor(c)}
                    className={cn(
                      'h-6 w-6 rounded border border-border',
                      c.h === color.h && c.s === color.s && 'outline-2 outline-primary',
                    )}
                    style={{ background: ledCss(c.h, c.s) }}
                  />
                ))}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDlgColor(color);
                setDlgOpen(true);
              }}
            >
              <Plus /> Custom color…
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2 pt-4">
            <div className="text-xs font-medium text-muted-foreground">
              Animation — L{layer} (last sent wins; device state unknown)
            </div>
            <div className="grid grid-cols-2 gap-1">
              {ANIM_NAMES.map((name, i) => (
                <Button
                  key={name}
                  variant="outline"
                  size="sm"
                  onClick={() => queueAnim(i)}
                >
                  {name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <ColorDialog
        open={dlgOpen}
        onOpenChange={setDlgOpen}
        color={dlgColor}
        onColor={setDlgColor}
        onAdd={addCustomColor}
      />
    </div>
  );
}
