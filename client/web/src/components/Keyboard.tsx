// Keyboard view — faithful NayaFlow look (transcribed from app.asar renderer:
// EY board grid, Zdt position map, f6/jtt shape selector, Xtt keycap outlines).
// Port of naya-web/kb-view.js. Controlled component: legends/fills come from
// props (paint after layer / LED dumps), selection lives in the parent.
import type { CSSProperties, SVGProps } from 'react';
import { describeRecord, ledCss } from '../lib/naya';
import { POS_KEY, POS_SHAPE, SHAPES } from '../lib/kb-data';
import type { KeyShape } from '../lib/kb-data';

export interface LedVal {
  h: number;
  s: number;
}

function attrName(k: string): string {
  return k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function ShapeSvg({ name, fill, stroke }: { name: string; fill: string; stroke: string }) {
  const sh: KeyShape = SHAPES[name] ?? SHAPES['Ve'];
  return (
    <svg
      width={Number(sh.w)}
      height={Number(sh.h)}
      viewBox={sh.vb}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      {sh.inners.map((el, i) => {
        const props: Record<string, string> = {};
        for (const [k, v] of el.attrs)
          props[attrName(k)] = v
            .split('{F}')
            .join(fill)
            .split('{S}')
            .join(stroke)
            .split('{O}')
            .join('1');
        if (el.tag === 'circle')
          return <circle key={i} {...(props as SVGProps<SVGCircleElement>)} />;
        if (el.tag === 'rect')
          return <rect key={i} {...(props as SVGProps<SVGRectElement>)} />;
        return <path key={i} {...(props as SVGProps<SVGPathElement>)} />;
      })}
    </svg>
  );
}

function shortLabel(rec: Uint8Array): string {
  const d = describeRecord(rec);
  if (d.startsWith('empty') || d.startsWith('index block') || d.startsWith('unknown'))
    return '';
  if (d === 'Naya key (factory)') return 'Naya';
  if (d.startsWith('macro')) return 'Macro';
  let m = d.match(/^BT Device (\d+)$/);
  if (m) return 'BT' + m[1];
  m = d.match(/^Mouse (Left|Right|Middle)$/);
  if (m) return 'M-' + m[1][0];
  if (d.startsWith('Mouse button')) return 'M?';
  m = d.match(/^LED effect #(\d+)$/);
  if (m) return 'FX' + m[1];
  if (d.startsWith('LED')) return 'LED';
  if (
    d.startsWith('vendor') ||
    d.startsWith('special') ||
    d.startsWith('Consumer') ||
    d.startsWith('usage page')
  )
    return d.slice(0, 8);
  return d.length > 10 ? d.slice(0, 10) : d;
}

interface KeyProps {
  pos: number;
  rec?: Uint8Array;
  led?: LedVal;
  ledMode: boolean;
  selected: boolean;
  onSelect: (pos: number, kk: number) => void;
}

function Key({ pos, rec, led, ledMode, selected, onSelect }: KeyProps) {
  const kk = pos; // positionId == KK index (proven: 0=Esc/LA1, 0x30=Z/LC4 …)
  const sh: KeyShape = SHAPES[POS_SHAPE[pos]] ?? SHAPES['Ve'];
  const label = rec ? shortLabel(rec) : (POS_KEY[String(pos)] ?? '');
  const fill = selected
    ? '#ffffff'
    : ledMode && led
      ? ledCss(led.h, led.s)
      : 'transparent';
  return (
    <div
      className="kb-key"
      data-pos={pos}
      title={`pos ${pos} = ${POS_KEY[String(pos)] ?? '?'} KK 0x${kk.toString(16)}${rec ? ' — ' + describeRecord(rec) : ''}`}
      onClick={() => onSelect(pos, kk)}
    >
      <div style={{ position: 'relative' }}>
        <ShapeSvg name={POS_SHAPE[pos]} fill={fill} stroke="#E5E1E6" />
        <div
          style={{
            position: 'absolute',
            transform: 'translate(-50%,-50%)',
            top: sh.lt,
            left: sh.ll,
            color: selected ? '#111' : '#E5E1E6',
            fontSize: 14,
            lineHeight: 1,
            textAlign: 'center',
            pointerEvents: 'none',
            whiteSpace: 'pre-line',
            // black halo: white legends stay readable on light LED fills
            textShadow:
              '2px 0 0 #000,-2px 0 0 #000,0 2px 0 #000,0 -2px 0 #000,' +
              '2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,' +
              '1px 0 0 #000,-1px 0 0 #000,0 1px 0 #000,0 -1px 0 #000',
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

interface KeyboardProps {
  keymap: Map<number, Uint8Array>;
  ledmap: Map<number, LedVal>;
  ledMode: boolean;
  selected: number;
  onSelect: (pos: number, kk: number) => void;
  /** disconnected: ignore clicks, render semi-transparent */
  disabled?: boolean;
}

export default function Keyboard({
  keymap,
  ledmap,
  ledMode,
  selected,
  onSelect,
  disabled = false,
}: KeyboardProps) {
  const pick = disabled ? () => {} : onSelect;
  const K = (pos: number) => (
    <Key
      key={pos}
      pos={pos}
      rec={keymap.get(pos)}
      led={ledmap.get(pos)}
      ledMode={ledMode}
      selected={selected === pos}
      onSelect={pick}
    />
  );
  const col = (extra: CSSProperties, keys: number[]) => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.1rem',
        width: '2.75rem',
        flexWrap: 'nowrap',
        ...extra,
      }}
    >
      {keys.map(K)}
    </div>
  );

  const halfLeft = (
    <div style={{ display: 'flex', paddingRight: '0.3rem', height: '100%', justifySelf: 'end' }}>
      {col({ marginTop: '1.5rem', marginRight: '0.5rem' }, [0, 16, 30, 46, 62])}
      {col({ marginRight: '0.6rem', marginTop: '1rem' }, [1, 17, 31, 47, 63])}
      {col({ marginTop: '0.5rem', marginRight: '0.5rem' }, [2, 18, 32, 48, 64])}
      {col({ marginRight: '0.5rem', marginTop: '0.2rem' }, [3, 19, 33, 49, 65])}
      <div
        style={{
          display: 'flex', flexDirection: 'column', gap: '0.1rem',
          flexWrap: 'nowrap', marginRight: '0.5rem', width: '2.75rem',
        }}
      >
        {[4, 20, 34].map(K)}
        <div style={{ display: 'flex', flexDirection: 'row-reverse', paddingTop: '0.1rem', paddingLeft: '2.6rem' }}>{K(50)}</div>
        <div style={{ paddingTop: '0.1rem', alignSelf: 'center', marginLeft: '4rem' }}>{K(66)}</div>
      </div>
      {col({ marginRight: '0.5rem' }, [5, 21, 35, 51])}
      <div
        style={{
          display: 'flex', flexDirection: 'column', gap: '0.1rem',
          flexWrap: 'nowrap', width: '2.75rem', marginRight: '0.5rem', marginTop: '0.15rem',
        }}
      >
        {[6, 22].map(K)}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'row', right: '0.2rem' }}>{K(36)}</div>
        {K(52)}
      </div>
      <div
        style={{
          display: 'flex', flexDirection: 'column', gap: '0.1rem',
          flexWrap: 'nowrap', width: '2.75rem', marginTop: '0.3rem',
        }}
      >
        {K(7)}
      </div>
    </div>
  );

  const halfRight = (
    <div style={{ display: 'flex', height: '100%', justifySelf: 'start' }}>
      {col({ marginTop: '0.3rem' }, [8])}
      <div
        style={{
          display: 'flex', flexDirection: 'column', gap: '0.1rem', width: '2.75rem',
          flexWrap: 'nowrap', marginLeft: '0.5rem', marginTop: '0.15rem',
        }}
      >
        {[9, 23].map(K)}
        <div style={{ display: 'flex', flexDirection: 'row-reverse', paddingLeft: '2.6rem' }}>{K(39)}</div>
        {K(55)}
      </div>
      {col({ marginLeft: '0.5rem' }, [10, 24, 40, 56])}
      <div
        style={{
          display: 'flex', flexDirection: 'column', gap: '0.1rem', width: '2.75rem',
          flexWrap: 'nowrap', marginLeft: '0.5rem',
        }}
      >
        {[11, 25, 41].map(K)}
        <div style={{ display: 'flex', flexDirection: 'row-reverse', paddingTop: '0.1rem', paddingLeft: '2.6rem' }}>{K(57)}</div>
        <div style={{ paddingTop: '0.1rem', alignSelf: 'center', marginRight: '4rem' }}>{K(69)}</div>
      </div>
      {col({ marginLeft: '0.5rem', marginTop: '0.2rem' }, [12, 26, 42, 58, 70])}
      {col({ marginLeft: '0.5rem', marginTop: '0.5rem' }, [13, 27, 43, 59, 71])}
      {col({ marginLeft: '0.6rem', marginTop: '1rem' }, [14, 28, 44, 60, 72])}
      {col({ marginLeft: '0.5rem', marginTop: '1.5rem' }, [15, 29, 45, 61, 73])}
    </div>
  );

  const dock = (
    <div
      style={{
        width: 44, height: 44, borderRadius: 10,
        border: '2px solid #555', background: '#222',
      }}
    />
  );

  const middle = (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: '1rem',
        justifyContent: 'space-between', paddingBottom: '1rem',
        alignItems: 'center', height: '100%',
      }}
    >
      <div
        style={{
          display: 'flex', justifyContent: 'center', gap: '3.3rem',
          height: '100%', alignItems: 'start', paddingTop: '1rem',
        }}
      >
        {dock}
        {dock}
      </div>
      <div>
        <div style={{ display: 'flex', gap: '0.25rem' }}>{[37, 53, 67].map(K)}</div>
        <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>{[68, 54, 38].map(K)}</div>
      </div>
    </div>
  );

  return (
    <div
      className={disabled ? 'opacity-50 saturate-50' : undefined}
      style={{
        display: 'grid', width: '100%', minWidth: 940, height: '15rem',
        gridTemplateColumns: '1fr 14rem 1fr', cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {halfLeft}
      {middle}
      {halfRight}
    </div>
  );
}
