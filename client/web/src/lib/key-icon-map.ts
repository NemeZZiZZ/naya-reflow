// Pure mapping: describeRecord() string -> key-icon file base name (no asset
// imports here, so node smoke tests stay bundler-free). Filenames live in
// src/assets/key-icons/<name>.svg (extracted from NayaFlow renderer
// dist/renderer/assets/icons/action/, recolored #fff -> currentColor).
// Returns null when no icon exists -> caller falls back to text legend.
export function keyIconName(d: string): string | null {
  const m = /^BT Device ([1-5])$/.exec(d);
  if (m) return 'BT_DEVICE_' + m[1];
  switch (d) {
    // HID main block
    case 'Enter': return 'RETURN';
    case 'Esc': return 'ESC';
    case 'Backspace': return 'BACKSPACE';
    case 'Tab': return 'TAB';
    case 'Space': return 'SPACE';
    case 'Caps Lock': return 'CAPSLOCK';
    case 'Print Screen': return 'PRINTSCREEN';
    case 'Scroll Lock': return 'SCROLLLOCK';
    case 'Pause': return 'PAUSE_BREAK';
    case 'Insert': return 'INSERT';
    case 'Home': return 'HOME';
    case 'Page Up': return 'PG_UP';
    case 'Delete': return 'DELETE';
    case 'End': return 'END';
    case 'Page Down': return 'PG_DN';
    case '→': return 'RIGHT';
    case '←': return 'LEFT';
    case '↓': return 'DOWN';
    case '↑': return 'UP';
    case 'Num Lock': return 'KP_NUMLOCK';
    // HID modifiers (no Shift icon exists in the NayaFlow set -> text fallback)
    case 'LCtrl': return 'LCTRL';
    case 'RCtrl': return 'RCTRL';
    case 'LAlt': return 'LALT';
    case 'RAlt': return 'RALT';
    case 'LGUI': return 'LGUI';
    case 'RGUI': return 'RGUI';
    // consumer page
    case 'Play/Pause': return 'C_PLAY_PAUSE';
    case 'Mute': return 'C_MUTE';
    case 'Volume +': return 'C_VOL_UP';
    case 'Volume −': return 'C_VOL_DOWN'; // U+2212, matches CONSUMER table
    case 'Next Track': return 'C_NEXT';
    case 'Prev Track': return 'C_PREVIOUS';
    // mouse buttons (no middle/wheel-click glyph in the set)
    case 'Mouse Left': return 'MOUSE_LEFT';
    case 'Mouse Right': return 'MOUSE_RIGHT';
    // vendor actions
    case 'Naya key (factory)': return 'NAYA';
    default: return null;
  }
}
