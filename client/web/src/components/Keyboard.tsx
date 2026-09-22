// Keyboard view — faithful NayaFlow look (transcribed from app.asar renderer:
// EY board grid, Zdt position map, f6/jtt shape selector, Xtt keycap outlines).
// Styled with Tailwind utilities (2.75rem cols = w-11); only data-driven
// legend anchors (top/left per shape) stay inline. Controlled component:
// legends/fills come from props (paint after layer / LED dumps),
// selection lives in the parent.
import type { SVGProps } from "react";
import { contrastStroke, describeRecord, hsToHex, ledCss, readableInk, toHex } from "../lib/naya";
import { keyIconName, shortLabel } from "../lib/key-icon-map";
import { KEY_ICONS } from "../lib/key-icons";
import { POS_KEY, POS_SHAPE, SHAPES } from "../lib/kb-data";
import type { KeyShape } from "../lib/kb-data";
import { cn } from "../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

export interface LedVal {
  h: number;
  s: number;
}

function attrName(k: string): string {
  return k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function ShapeSvg({
  name,
  fill,
  stroke,
  className,
}: {
  name: string;
  fill?: string;
  stroke?: string;
  className?: string;
}) {
  const sh: KeyShape = SHAPES[name] ?? SHAPES["Ve"];
  return (
    <svg
      width={Number(sh.w)}
      height={Number(sh.h)}
      viewBox={sh.vb}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {sh.inners.map((el, i) => {
        const props: Record<string, string> = {};
        for (const [k, v] of el.attrs)
          props[attrName(k)] = v
            .split("{F}")
            .join(fill)
            .split("{S}")
            .join(stroke)
            .split("{O}")
            .join("1");
        if (el.tag === "circle")
          return <circle key={i} {...(props as SVGProps<SVGCircleElement>)} />;
        if (el.tag === "rect")
          return <rect key={i} {...(props as SVGProps<SVGRectElement>)} />;
        return <path key={i} {...(props as SVGProps<SVGPathElement>)} />;
      })}
    </svg>
  );
}

interface KeyProps {
  pos: number;
  rec?: Uint8Array;
  led?: LedVal;
  ledMode: boolean;
  selected: boolean;
  dirty?: boolean;
  onSelect: (
    pos: number,
    kk: number,
    additive: boolean,
    allLayers: boolean,
  ) => void;
}

function Key({ pos, rec, led, ledMode, selected, dirty, onSelect }: KeyProps) {
  const kk = pos; // positionId == KK index (proven: 0=Esc/LA1, 0x30=Z/LC4 …)
  const label = rec ? shortLabel(rec) : (POS_KEY[String(pos)] ?? "");
  // action glyph for non-standard keys (currentColor => follows legend color);
  // null -> text legend fallback (letters, digits, Shift, Menu, F-keys …)
  const iconName = rec ? keyIconName(describeRecord(rec)) : null;
  const icon = iconName ? KEY_ICONS[iconName] : undefined;
  // LED fills get readability-driven ink + (when selected) a max-delta ring
  // instead of the hardcoded white-fill selection (UHK a11y pattern).
  const ledFill = ledMode && led ? ledCss(led.h, led.s) : null;
  const fill = ledFill ?? (selected ? "#ffffff" : "transparent");
  const ink = ledFill ? readableInk(ledFill) : null;
  const stroke = ledFill && selected ? contrastStroke(ledFill) : "#E5E1E6";
  // UHK-style hover tooltip: full action breakdown (slot lines + raw hex),
  // in LED mode the color row leads.
  const desc = rec ? describeRecord(rec) : null;
  const tip = (
    <div className="grid gap-0.5">
      <div className="font-medium">
        {POS_KEY[String(pos)] ?? "?"}
        <span className="ml-2 font-normal text-muted-foreground">
          pos {pos} · KK 0x{kk.toString(16)}
        </span>
      </div>
      {ledMode && led && (
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-sm border border-border"
            style={{ background: ledCss(led.h, led.s) }}
          />
          <span className="font-mono">{hsToHex(led.h, led.s)}</span>
          <span className="text-muted-foreground">
            H {led.h} · S {led.s}
          </span>
        </div>
      )}
      {desc ? (
        desc
          .split(" / ")
          .map((line, i) =>
            i === 0 && !ledMode ? (
              <div key={i}>{line}</div>
            ) : (
              <div key={i} className="text-muted-foreground">
                {line}
              </div>
            ),
          )
      ) : (
        !ledMode && (
          <div className="text-muted-foreground">no record — transparent</div>
        )
      )}
      {rec && (
        <div className="font-mono text-[10px] text-muted-foreground">
          {toHex(rec)}
        </div>
      )}
    </div>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="kb-key"
          data-pos={pos}
          style={
            selected && ledFill
              ? { outline: `2px solid ${contrastStroke(ledFill)}`, outlineOffset: 1 }
              : undefined
          }
          onClick={(e) => onSelect(pos, kk, e.shiftKey, e.altKey)}
        >
      <div className="relative">
        <ShapeSvg name={POS_SHAPE[pos]} fill={fill} stroke={stroke} />
        <span
          className={cn(
            "absolute text-sm left-1/2 top-1/2 -translate-1/2 font-medium whitespace-nowrap [&_svg]:block [&_svg]:size-8",
            !ink && {
              "text-gray-900": selected,
              "text-gray-100 text-shadow-[-1px_-1px_0_rgba(0,0,0,.5),1px_-1px_0_rgba(0,0,0,.5),-1px_1px_0_rgba(0,0,0,.5),1px_1px_0_rgba(0,0,0,.5)]":
                !selected,
            },
          )}
          style={ink ? { color: ink } : undefined}
          dangerouslySetInnerHTML={{ __html: icon ? icon : label }}
        />
        {dirty && (
          <span
            className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-400"
            title="queued change — not flashed yet"
          />
        )}
      </div>
        </div>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

interface KeyboardProps {
  keymap: Map<number, Uint8Array>;
  ledmap: Map<number, LedVal>;
  ledMode: boolean;
  /** selected KKs of the viewed layer (Shift+click multi, Alt+click all layers) */
  sel: Set<number>;
  onSelect: (
    pos: number,
    kk: number,
    additive: boolean,
    allLayers: boolean,
  ) => void;
  /** disconnected: ignore clicks, render semi-transparent */
  disabled?: boolean;
  /** KKs with queued (not yet flashed) changes — get a dot marker */
  dirty?: Set<number>;
}

export default function Keyboard({
  keymap,
  ledmap,
  ledMode,
  sel,
  onSelect,
  disabled = false,
  dirty,
}: KeyboardProps) {
  const pick = (
    pos: number,
    kk: number,
    additive: boolean,
    allLayers: boolean,
  ) => {
    if (!disabled) onSelect(pos, kk, additive, allLayers);
  };
  const K = (pos: number) => (
    <Key
      key={pos}
      pos={pos}
      rec={keymap.get(pos)}
      led={ledmap.get(pos)}
      ledMode={ledMode}
      selected={sel.has(pos)}
      dirty={dirty?.has(pos) ?? false}
      onSelect={pick}
    />
  );
  const col = (extra: string, keys: number[]) => (
    <div className={cn("flex flex-col gap-1 w-11 flex-nowrap", extra)}>
      {keys.map(K)}
    </div>
  );

  const halfLeft = (
    <div className="flex h-full justify-self-end gap-1">
      {col("mt-[1.5rem]", [0, 16, 30, 46, 62])}
      {col("mt-[1rem]", [1, 17, 31, 47, 63])}
      {col("mt-[0.5rem]", [2, 18, 32, 48, 64])}
      {col("mt-[0.2rem]", [3, 19, 33, 49, 65])}
      <div className="flex flex-col gap-1 flex-nowrap w-11">
        {[4, 20, 34].map(K)}
        {K(50)}
        <span className="-mr-17">{K(66)}</span>
      </div>
      {col("gap-0.75", [5, 21, 35, 51])}
      <div className="flex flex-col gap-0.5 flex-nowrap w-11 mt-[0.15rem]">
        {[6, 22].map(K)}
        <span>{K(36)}</span>
        {K(52)}
      </div>
      <div className="flex flex-col gap-1 flex-nowrap w-11 mt-[0.3rem]">
        {K(7)}
      </div>
    </div>
  );

  const halfRight = (
    <div className="flex h-full justify-self-start gap-1">
      {col("mt-[0.3rem]", [8])}
      <div className="flex flex-col gap-0.5 flex-nowrap w-11 mt-[0.15rem]">
        {[9, 23].map(K)}
        <span className="-ml-2">{K(39)}</span>
        {K(55)}
      </div>
      {col("gap-0.75", [10, 24, 40, 56])}
      <div className="flex flex-col gap-1 flex-nowrap w-11">
        {[11, 25, 41].map(K)}
        {K(57)}
        <span className="-ml-17">{K(69)}</span>
      </div>
      {col("mt-[0.2rem]", [12, 26, 42, 58, 70])}
      {col("mt-[0.5rem]", [13, 27, 43, 59, 71])}
      {col("mt-[1rem]", [14, 28, 44, 60, 72])}
      {col("mt-[1.5rem]", [15, 29, 45, 61, 73])}
    </div>
  );

  const dock = (
    <div className="h-11 w-11 rounded-[10px] border-2 border-[#555] bg-[#222]" />
  );

  const middle = (
    <div className="flex flex-col gap-4 justify-between pb-4 items-center h-full">
      <div className="flex justify-center gap-[3.3rem] h-full items-start pt-4">
        {dock}
        {dock}
      </div>
      <div className="-mx-12 flex items-center justify-between gap-8">
        <div className="flex gap-1">{[37, 53, 67].map(K)}</div>
        <div className="flex gap-1">{[68, 54, 38].map(K)}</div>
      </div>
    </div>
  );

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className={cn(
          "grid w-full min-w-235 grid-cols-[1fr_14rem_1fr] gap-1 select-none",
          {
            "opacity-50 saturate-50 cursor-default": disabled,
            "cursor-pointer": !disabled,
          },
        )}
      >
        {halfLeft}
        {middle}
        {halfRight}
      </div>
    </TooltipProvider>
  );
}
