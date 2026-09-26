/* Action palette: categorized, searchable action grid. Pure UI — the parent
 * supplies onPick(action). Categories render as an accordion; while a search
 * query is active every non-empty group is force-expanded and empty groups
 * are hidden. The Keyboard category renders as physical-layout rows
 * (UHK #7) with a custom-HID escape hatch; search falls back to a flat
 * grid for scanability. */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  ACTIONS,
  ACTION_CATEGORIES,
  buildRecord,
  type ActionDef,
} from "../lib/actions";
import { describeRecord } from "../lib/naya";
import { keyIconName, shortLabel } from "../lib/key-icon-map";
import { KEY_ICONS } from "../lib/key-icons";
import {
  customHidAction,
  groupKeyboardCategory,
  parseCustomHid,
} from "../lib/palette-groups";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "./ui/input-group";

// Palette glyph = the same icon the keycap will show: build the record with
// a dummy KK=0, describe it, resolve via the shared map. The mapping is
// KK-independent (exact names / KK-tolerant regexes), bodies are
// deterministic, so results are cached per action id.
const iconCache = new Map<string, string | undefined>();
function actionIcon(a: ActionDef): string | undefined {
  if (!iconCache.has(a.id)) {
    const name = keyIconName(describeRecord(buildRecord(0, a.body())));
    iconCache.set(a.id, name ? KEY_ICONS[name] : undefined);
  }
  return iconCache.get(a.id);
}

function ActionBtn({
  a,
  pickedId,
  onPick,
  cls,
}: {
  a: ActionDef;
  pickedId?: string | null;
  onPick: (a: ActionDef) => void;
  cls?: string;
}) {
  const icon = actionIcon(a);
  // Text fallback matches the keycap legend (short), not the long catalog
  // label — e.g. LShift instead of Left Shift.
  const text = shortLabel(buildRecord(0, a.body())) || a.label;
  return (
    <Button
      variant={pickedId === a.id ? "default" : "outline"}
      title={a.label}
      className={cn("hover:bg-accent truncate h-auto text-sm", cls)}
      onClick={() => onPick(a)}
    >
      {icon ? (
        <span
          className="[&_svg]:size-9"
          dangerouslySetInnerHTML={{ __html: icon }}
        />
      ) : (
        text
      )}
    </Button>
  );
}

/* Physical-row widths: wide cluster keys get 2-4 tiles, everything else
 * stays a single square. Space earns a thumb-sized bar. */
const WIDE = new Set([
  "Esc", "Tab", "Caps Lock", "Enter", "Backspace",
  "Insert", "Home", "Page Up", "Delete", "End", "Page Down",
  "Left Ctrl", "Left Shift", "Left Alt", "Left GUI",
  "Right Ctrl", "Right Shift", "Right Alt", "Right GUI",
  "Print Screen", "Scroll Lock", "Pause",
  "F10", "F11", "F12",
]);
function rowCls(label: string): string {
  if (label === "Space") return "w-24 min-w-24 h-9";
  if (WIDE.has(label)) return "w-16 min-w-16 h-9";
  return "w-9 min-w-9 h-9";
}

function CustomHidRow({ onPick }: { onPick: (a: ActionDef) => void }) {
  const [v, setV] = useState("");
  const usage = parseCustomHid(v);
  return (
    <form
      className="mt-2 flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (usage != null) {
          onPick(customHidAction(usage));
          setV("");
        }
      }}
    >
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        Custom HID
      </span>
      <InputGroup className="h-8 text-xs w-28">
        <InputGroupInput
          placeholder="hex, e.g. 4f"
          value={v}
          onChange={(e) => setV(e.target.value)}
          className="text-xs font-mono"
          aria-label="Custom HID usage, hex byte"
        />
      </InputGroup>
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={usage == null}
        title="Queue this HID usage as the action (keyboard page 0x0007)"
      >
        Pick
      </Button>
    </form>
  );
}

export default function ActionPalette({
  onPick,
  pickedId,
  filter,
}: {
  onPick: (a: ActionDef) => void;
  pickedId?: string | null;
  filter?: (a: ActionDef) => boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string[]>(["Keyboard"]);

  const needle = q.trim().toLowerCase();
  const groups = useMemo(
    () =>
      ACTION_CATEGORIES.map((cat) => ({
        cat,
        items: ACTIONS.filter(
          (a) =>
            a.category === cat &&
            (!filter || filter(a)) &&
            (!needle || a.label.toLowerCase().includes(needle)),
        ),
      })).filter((g) => !needle || g.items.length > 0),
    [needle, filter],
  );
  // Searching force-expands every group with hits; otherwise user-controlled.
  const value = needle ? groups.map((g) => g.cat) : open;
  // Physical rows for the Keyboard category (UHK #7) — only when browsing;
  // search keeps the flat grid.
  const kbGroup = useMemo(
    () =>
      !needle
        ? groupKeyboardCategory(
            ACTIONS.filter(
              (a) => a.category === "Keyboard" && (!filter || filter(a)),
            ),
          )
        : null,
    [needle, filter],
  );

  return (
    <div className="flex flex-col gap-2">
      <InputGroup className="h-8 text-xs">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          placeholder="Search actions…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="text-xs"
        />
      </InputGroup>
      {groups.length === 0 && (
        <div className="text-xs text-muted-foreground py-4 text-center">
          No actions match.
        </div>
      )}
      <Accordion
        type="multiple"
        value={value}
        onValueChange={setOpen}
        className="max-h-64 overflow-y-auto pr-1"
      >
        {groups.map((g) => (
          <AccordionItem key={g.cat} value={g.cat}>
            <div className="sticky top-0 bg-card">
              <AccordionTrigger className="justify-start">
                {g.cat}
                <span className="ml-2 mr-auto font-mono text-xs text-muted-foreground">
                  {g.items.length}
                </span>
              </AccordionTrigger>
            </div>
            <AccordionContent>
              {kbGroup && g.cat === "Keyboard" ? (
                <>
                  {kbGroup.rows.map((row, i) => (
                    <div key={i} className="mb-1 flex flex-wrap gap-1">
                      {row.map((a) => (
                        <ActionBtn
                          key={a.id}
                          a={a}
                          pickedId={pickedId}
                          onPick={onPick}
                          cls={rowCls(a.label)}
                        />
                      ))}
                    </div>
                  ))}
                  {kbGroup.rest.length > 0 && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1">
                      {kbGroup.rest.map((a) => (
                        <ActionBtn
                          key={a.id}
                          a={a}
                          pickedId={pickedId}
                          onPick={onPick}
                          cls="aspect-square"
                        />
                      ))}
                    </div>
                  )}
                  <CustomHidRow onPick={onPick} />
                </>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1">
                  {g.items.map((a) => (
                    <ActionBtn
                      key={a.id}
                      a={a}
                      pickedId={pickedId}
                      onPick={onPick}
                      cls={cn("aspect-square", {
                        "text-xl": a.label.length < 4,
                      })}
                    />
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
