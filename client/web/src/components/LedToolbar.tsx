/* LED toolbar for the keyboard card in LED mode: brush / fill / pipette
 * tools + a small preset palette. Colors are queued into the draft, not
 * written immediately. */

import { Brush, PaintBucket, Pipette } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { hsToHex } from '../lib/naya';

export type LedTool = 'brush' | 'fill' | 'pipette';

export const LED_PRESETS: { name: string; h: number; s: number }[] = [
  { name: 'Amber (factory)', h: 38, s: 100 },
  { name: 'Red', h: 0, s: 100 },
  { name: 'Orange', h: 30, s: 100 },
  { name: 'Yellow', h: 60, s: 100 },
  { name: 'Green', h: 120, s: 100 },
  { name: 'Cyan', h: 180, s: 100 },
  { name: 'Blue', h: 240, s: 100 },
  { name: 'Magenta', h: 300, s: 70 },
  { name: 'White', h: 0, s: 0 },
];

export default function LedToolbar({
  tool,
  onTool,
  color,
  onColor,
  disabled,
}: {
  tool: LedTool;
  onTool: (t: LedTool) => void;
  color: { h: number; s: number };
  onColor: (c: { h: number; s: number }) => void;
  disabled: boolean;
}) {
  const tools: { id: LedTool; icon: typeof Brush; label: string }[] = [
    { id: 'brush', icon: Brush, label: 'Brush — paint clicked keys' },
    { id: 'fill', icon: PaintBucket, label: 'Fill — queue all keys at once' },
    { id: 'pipette', icon: Pipette, label: 'Pipette — pick color from a key' },
  ];
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {tools.map((t) => (
        <Button
          key={t.id}
          size="sm"
          variant={tool === t.id ? 'default' : 'outline'}
          title={t.label}
          disabled={disabled}
          onClick={() => onTool(t.id)}
        >
          <t.icon className="size-4" />
          {t.id[0].toUpperCase() + t.id.slice(1)}
        </Button>
      ))}
      <span className="mx-2 h-6 w-px bg-border" />
      {LED_PRESETS.map((p) => (
        <button
          key={p.name}
          title={`${p.name} (H${p.h} S${p.s})`}
          disabled={disabled}
          className={cn(
            'size-6 rounded-full border border-border',
            color.h === p.h && color.s === p.s && 'ring-2 ring-primary',
          )}
          style={{ background: hsToHex(p.h, p.s) }}
          onClick={() => onColor({ h: p.h, s: p.s })}
        />
      ))}
      <span className="ml-2 text-xs text-muted-foreground">
        brush color H{color.h} S{color.s}
      </span>
    </div>
  );
}
