// KBView — faithful NayaFlow keyboard look (transcribed from app.asar renderer:
// EY board grid, Zdt position map, f6/jtt shape selector, Xtt keycap outlines).
// Data comes from kb-data.js (POS_KEY, POS_SHAPE, SHAPES). Legends/fills are live:
// paintKeymap() after a layer dump, paintLed() after an LED dump.
'use strict';
const KBView = (() => {
  let keymap = new Map();   // kk -> rec (first wins)
  let ledmap = new Map();   // kk -> {h,s}
  let ledMode = true;
  let selected = -1;
  let onSelect = null;      // callback(pos, kk)
  const F6 = POS_SHAPE;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function shapeSVG(name, fill, stroke) {
    const sh = SHAPES[name] || SHAPES.Ve;
    // original renders fixed pixel size (width="112" height="53" etc.),
    // columns are only positioning scaffolding — never stretch to 100%
    const size = (sh.w && sh.h) ? ` width="${sh.w}" height="${sh.h}"` : '';
    let inner = '';
    for (const el of sh.inners) {
      const attrs = el.attrs.map(([k, v]) =>
        `${k.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase())}="${v.split('{F}').join(fill).split('{S}').join(stroke).split('{O}').join('1')}"`
      ).join(' ');
      inner += `<${el.tag} ${attrs}/>`;
    }
    return `<svg viewBox="${sh.vb}"${size} style="display:block" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  }

  function shortLabel(rec) {
    const d = Naya.describeRecord(rec);
    if (d.startsWith('empty') || d.startsWith('index block') || d.startsWith('unknown')) return '';
    if (d === 'Naya key (factory)') return 'Naya';
    if (d.startsWith('macro')) return 'Macro';
    let m = d.match(/^BT Device (\d+)$/); if (m) return 'BT' + m[1];
    m = d.match(/^Mouse (Left|Right|Middle)$/); if (m) return 'M-' + m[1][0];
    if (d.startsWith('Mouse button')) return 'M?';
    m = d.match(/^LED effect #(\d+)$/); if (m) return 'FX' + m[1];
    if (d.startsWith('LED')) return 'LED';
    if (d.startsWith('vendor') || d.startsWith('special') || d.startsWith('Consumer') || d.startsWith('usage page')) return d.slice(0, 8);
    return d.length > 10 ? d.slice(0, 10) : d;
  }

  function keyFill(kk) {
    if (kk === selected) return '#ffffff';
    if (ledMode && ledmap.has(kk)) return Naya.ledCss(ledmap.get(kk).h, ledmap.get(kk).s);
    return 'transparent';
  }

  function keyHTML(pos) {
    const kk = pos; // positionId == KK index (proven: 0=Esc/LA1, 0x30=Z/LC4 …)
    const rec = keymap.get(kk);
    const label = rec ? shortLabel(rec) : (POS_KEY[pos] || '');
    const sh = SHAPES[F6[pos]] || SHAPES.Ve;
    const legendColor = kk === selected ? '#111' : '#E5E1E6';
    return `<div class="kb-key" data-pos="${pos}" title="pos ${pos} = ${POS_KEY[pos] || '?'} KK 0x${kk.toString(16)}${rec ? ' — ' + esc(Naya.describeRecord(rec)) : ''}">` +
      `<div style="position:relative">${shapeSVG(F6[pos], keyFill(kk), '#E5E1E6')}` +
      `<div style="position:absolute;transform:translate(-50%,-50%);top:${sh.lt};left:${sh.ll};color:${legendColor};font-size:10px;line-height:1;text-align:center;pointer-events:none;white-space:pre-line">${esc(label)}</div>` +
      `</div></div>`;
  }

  const col = (extra, keys) =>
    `<div style="display:flex;flex-direction:column;gap:0.1rem;width:2.5rem;flex-wrap:nowrap;${extra}">${keys.map(keyHTML).join('')}</div>`;

  function halfLeft() {
    return `<div style="display:flex;padding-right:0.3rem;height:100%;justify-self:end">` +
      col('margin-top:1.5rem;margin-right:0.5rem', [0, 16, 30, 46, 62]) +
      col('margin-right:0.6rem;margin-top:1rem', [1, 17, 31, 47, 63]) +
      col('margin-top:0.5rem;margin-right:0.5rem', [2, 18, 32, 48, 64]) +
      col('margin-right:0.5rem;margin-top:0.2rem', [3, 19, 33, 49, 65]) +
      `<div style="display:flex;flex-direction:column;gap:0.1rem;flex-wrap:nowrap;margin-right:0.5rem;width:2.5rem">` +
        [4, 20, 34].map(keyHTML).join('') +
        `<div style="display:flex;flex-direction:row-reverse;padding-top:0.1rem;padding-left:2.6rem">${keyHTML(50)}</div>` +
        `<div style="padding-top:0.1rem;align-self:center;margin-left:4rem">${keyHTML(66)}</div></div>` +
      col('margin-right:0.5rem', [5, 21, 35, 51]) +
      `<div style="display:flex;flex-direction:column;gap:0.1rem;flex-wrap:nowrap;width:2.5rem;margin-right:0.5rem;margin-top:0.15rem">` +
        [6, 22].map(keyHTML).join('') +
        `<div style="position:relative;display:flex;flex-direction:row;right:0.2rem">${keyHTML(36)}</div>` +
        keyHTML(52) + `</div>` +
      `<div style="display:flex;flex-direction:column;gap:0.1rem;flex-wrap:nowrap;width:2.5rem;margin-top:0.3rem">${keyHTML(7)}</div>` +
      `</div>`;
  }

  function halfRight() {
    return `<div style="display:flex;height:100%;justify-self:start">` +
      col('margin-top:0.3rem', [8]) +
      `<div style="display:flex;flex-direction:column;gap:0.1rem;width:2.5rem;flex-wrap:nowrap;margin-left:0.5rem;margin-top:0.15rem">` +
        [9, 23].map(keyHTML).join('') +
        `<div style="display:flex;flex-direction:row-reverse;padding-left:2.6rem">${keyHTML(39)}</div>` +
        keyHTML(55) + `</div>` +
      col('margin-left:0.5rem', [10, 24, 40, 56]) +
      `<div style="display:flex;flex-direction:column;gap:0.1rem;width:2.5rem;flex-wrap:nowrap;margin-left:0.5rem">` +
        [11, 25, 41].map(keyHTML).join('') +
        `<div style="display:flex;flex-direction:row-reverse;padding-top:0.1rem;padding-left:2.6rem">${keyHTML(57)}</div>` +
        `<div style="padding-top:0.1rem;align-self:center;margin-right:4rem">${keyHTML(69)}</div></div>` +
      col('margin-left:0.5rem;margin-top:0.2rem', [12, 26, 42, 58, 70]) +
      col('margin-left:0.5rem;margin-top:0.5rem', [13, 27, 43, 59, 71]) +
      col('margin-left:0.6rem;margin-top:1rem', [14, 28, 44, 60, 72]) +
      col('margin-left:0.5rem;margin-top:1.5rem', [15, 29, 45, 61, 73]) +
      `</div>`;
  }

  function dockHTML() {
    // module dock: rounded square like module-slot.svg, dark until module data arrives
    return `<div style="width:44px;height:44px;border-radius:10px;border:2px solid #555;background:#222"></div>`;
  }

  function middle() {
    return `<div style="display:flex;flex-direction:column;gap:1rem;justify-content:space-between;padding-bottom:1rem;align-items:center;height:100%">` +
      `<div style="display:flex;justify-content:center;gap:3.3rem;height:100%;align-items:start;padding-top:1rem">${dockHTML()}${dockHTML()}</div>` +
      `<div><div style="display:flex;gap:0.25rem">${[37, 53, 67].map(keyHTML).join('')}</div>` +
      `<div style="display:flex;gap:0.25rem;margin-top:0.25rem">${[68, 54, 38].map(keyHTML).join('')}</div></div>` +
      `</div>`;
  }

  function render(host) {
    host.innerHTML =
      `<div style="display:grid;width:100%;min-width:940px;height:15rem;grid-template-columns:1fr 14rem 1fr;cursor:pointer">` +
      halfLeft() + middle() + halfRight() + `</div>`;
    host.querySelectorAll('.kb-key').forEach((el) => {
      el.addEventListener('click', () => {
        selected = parseInt(el.dataset.pos, 10);
        repaint(host);
        if (onSelect) onSelect(selected, selected);
      });
    });
  }

  function repaint(host) {
    host.querySelectorAll('.kb-key').forEach((el) => {
      const pos = parseInt(el.dataset.pos, 10);
      const tmp = document.createElement('div');
      tmp.innerHTML = keyHTML(pos);
      el.replaceWith(tmp.firstChild);
    });
    host.querySelectorAll('.kb-key').forEach((el) => {
      el.addEventListener('click', () => {
        selected = parseInt(el.dataset.pos, 10);
        repaint(host);
        if (onSelect) onSelect(selected, selected);
      });
    });
  }

  return {
    render,
    repaint,
    paintKeymap(recs) { keymap = new Map(); for (const r of recs) if (!keymap.has(r.kk)) keymap.set(r.kk, r.rec); },
    paintLed(recs) { ledmap = new Map(recs.map((r) => [r.kk, { h: r.h, s: r.s }])); },
    setLedMode(v) { ledMode = v; },
    setOnSelect(cb) { onSelect = cb; },
  };
})();
