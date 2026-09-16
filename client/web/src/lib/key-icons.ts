// Raw SVG bodies for keycap legends (?raw => string at build time).
// Files: src/assets/key-icons/*.svg — extracted from the NayaFlow renderer
// (dist/renderer/assets/icons/action/), recolored #fff -> currentColor,
// so the keycap legend color flows in automatically.
import svg_ESC from '../assets/key-icons/ESC.svg?raw';
import svg_TAB from '../assets/key-icons/TAB.svg?raw';
import svg_CAPSLOCK from '../assets/key-icons/CAPSLOCK.svg?raw';
import svg_BACKSPACE from '../assets/key-icons/BACKSPACE.svg?raw';
import svg_RETURN from '../assets/key-icons/RETURN.svg?raw';
import svg_SPACE from '../assets/key-icons/SPACE.svg?raw';
import svg_LCTRL from '../assets/key-icons/LCTRL.svg?raw';
import svg_RCTRL from '../assets/key-icons/RCTRL.svg?raw';
import svg_LCTRL_MAC from '../assets/key-icons/LCTRL_MAC.svg?raw';
import svg_RCTRL_MAC from '../assets/key-icons/RCTRL_MAC.svg?raw';
import svg_LALT from '../assets/key-icons/LALT.svg?raw';
import svg_RALT from '../assets/key-icons/RALT.svg?raw';
import svg_LGUI from '../assets/key-icons/LGUI.svg?raw';
import svg_RGUI from '../assets/key-icons/RGUI.svg?raw';
import svg_LCMD from '../assets/key-icons/LCMD.svg?raw';
import svg_RCMD from '../assets/key-icons/RCMD.svg?raw';
import svg_LWIN from '../assets/key-icons/LWIN.svg?raw';
import svg_RWIN from '../assets/key-icons/RWIN.svg?raw';
import svg_UP from '../assets/key-icons/UP.svg?raw';
import svg_DOWN from '../assets/key-icons/DOWN.svg?raw';
import svg_LEFT from '../assets/key-icons/LEFT.svg?raw';
import svg_RIGHT from '../assets/key-icons/RIGHT.svg?raw';
import svg_HOME from '../assets/key-icons/HOME.svg?raw';
import svg_END from '../assets/key-icons/END.svg?raw';
import svg_PG_UP from '../assets/key-icons/PG_UP.svg?raw';
import svg_PG_DN from '../assets/key-icons/PG_DN.svg?raw';
import svg_INSERT from '../assets/key-icons/INSERT.svg?raw';
import svg_DELETE from '../assets/key-icons/DELETE.svg?raw';
import svg_PRINTSCREEN from '../assets/key-icons/PRINTSCREEN.svg?raw';
import svg_SCROLLLOCK from '../assets/key-icons/SCROLLLOCK.svg?raw';
import svg_PAUSE_BREAK from '../assets/key-icons/PAUSE_BREAK.svg?raw';
import svg_KP_NUMLOCK from '../assets/key-icons/KP_NUMLOCK.svg?raw';
import svg_NAYA from '../assets/key-icons/NAYA.svg?raw';
import svg_BT_CLEAR from '../assets/key-icons/BT_CLEAR.svg?raw';
import svg_BT_DEVICE_1 from '../assets/key-icons/BT_DEVICE_1.svg?raw';
import svg_BT_DEVICE_2 from '../assets/key-icons/BT_DEVICE_2.svg?raw';
import svg_BT_DEVICE_3 from '../assets/key-icons/BT_DEVICE_3.svg?raw';
import svg_BT_DEVICE_4 from '../assets/key-icons/BT_DEVICE_4.svg?raw';
import svg_BT_DEVICE_5 from '../assets/key-icons/BT_DEVICE_5.svg?raw';
import svg_MOUSE_LEFT from '../assets/key-icons/MOUSE_LEFT.svg?raw';
import svg_MOUSE_RIGHT from '../assets/key-icons/MOUSE_RIGHT.svg?raw';
import svg_MOUSE_UP from '../assets/key-icons/MOUSE_UP.svg?raw';
import svg_MOUSE_DOWN from '../assets/key-icons/MOUSE_DOWN.svg?raw';
import svg_C_PLAY_PAUSE from '../assets/key-icons/C_PLAY_PAUSE.svg?raw';
import svg_C_MUTE from '../assets/key-icons/C_MUTE.svg?raw';
import svg_C_VOL_UP from '../assets/key-icons/C_VOL_UP.svg?raw';
import svg_C_VOL_DOWN from '../assets/key-icons/C_VOL_DOWN.svg?raw';
import svg_C_PREVIOUS from '../assets/key-icons/C_PREVIOUS.svg?raw';
import svg_C_NEXT from '../assets/key-icons/C_NEXT.svg?raw';
import svg_F1 from '../assets/key-icons/F1.svg?raw';
import svg_F12 from '../assets/key-icons/F12.svg?raw';
import svg_F24 from '../assets/key-icons/F24.svg?raw';

export const KEY_ICONS: Record<string, string> = {
  ESC: svg_ESC,
  TAB: svg_TAB,
  CAPSLOCK: svg_CAPSLOCK,
  BACKSPACE: svg_BACKSPACE,
  RETURN: svg_RETURN,
  SPACE: svg_SPACE,
  LCTRL: svg_LCTRL,
  RCTRL: svg_RCTRL,
  LCTRL_MAC: svg_LCTRL_MAC,
  RCTRL_MAC: svg_RCTRL_MAC,
  LALT: svg_LALT,
  RALT: svg_RALT,
  LGUI: svg_LGUI,
  RGUI: svg_RGUI,
  LCMD: svg_LCMD,
  RCMD: svg_RCMD,
  LWIN: svg_LWIN,
  RWIN: svg_RWIN,
  UP: svg_UP,
  DOWN: svg_DOWN,
  LEFT: svg_LEFT,
  RIGHT: svg_RIGHT,
  HOME: svg_HOME,
  END: svg_END,
  PG_UP: svg_PG_UP,
  PG_DN: svg_PG_DN,
  INSERT: svg_INSERT,
  DELETE: svg_DELETE,
  PRINTSCREEN: svg_PRINTSCREEN,
  SCROLLLOCK: svg_SCROLLLOCK,
  PAUSE_BREAK: svg_PAUSE_BREAK,
  KP_NUMLOCK: svg_KP_NUMLOCK,
  NAYA: svg_NAYA,
  BT_CLEAR: svg_BT_CLEAR,
  BT_DEVICE_1: svg_BT_DEVICE_1,
  BT_DEVICE_2: svg_BT_DEVICE_2,
  BT_DEVICE_3: svg_BT_DEVICE_3,
  BT_DEVICE_4: svg_BT_DEVICE_4,
  BT_DEVICE_5: svg_BT_DEVICE_5,
  MOUSE_LEFT: svg_MOUSE_LEFT,
  MOUSE_RIGHT: svg_MOUSE_RIGHT,
  MOUSE_UP: svg_MOUSE_UP,
  MOUSE_DOWN: svg_MOUSE_DOWN,
  C_PLAY_PAUSE: svg_C_PLAY_PAUSE,
  C_MUTE: svg_C_MUTE,
  C_VOL_UP: svg_C_VOL_UP,
  C_VOL_DOWN: svg_C_VOL_DOWN,
  C_PREVIOUS: svg_C_PREVIOUS,
  C_NEXT: svg_C_NEXT,
  F1: svg_F1,
  F12: svg_F12,
  F24: svg_F24,
};
