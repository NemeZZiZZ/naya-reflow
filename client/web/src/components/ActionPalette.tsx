/* Action palette: categorized, searchable action grid. Pure UI — the parent
 * supplies onPick(action). Categories render as an accordion; while a search
 * query is active every non-empty group is force-expanded and empty groups
 * are hidden. */

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

export default function ActionPalette({
  onPick,
  pickedId,
}: {
  onPick: (a: ActionDef) => void;
  pickedId?: string | null;
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
            (!needle || a.label.toLowerCase().includes(needle)),
        ),
      })).filter((g) => !needle || g.items.length > 0),
    [needle],
  );
  // Searching force-expands every group with hits; otherwise user-controlled.
  const value = needle ? groups.map((g) => g.cat) : open;

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
              <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1">
                {g.items.map((a) => {
                  const icon = actionIcon(a);
                  // Text fallback matches the keycap legend (short), not the
                  // long catalog label — e.g. LShift instead of Left Shift.
                  const text = shortLabel(buildRecord(0, a.body())) || a.label;
                  return (
                    <Button
                      variant={pickedId === a.id ? "default" : "outline"}
                      key={a.id}
                      title={a.label}
                      className={cn(
                        "hover:bg-accent truncate aspect-square h-auto text-sm",
                        { "text-xl": a.label.length < 4 },
                      )}
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
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
