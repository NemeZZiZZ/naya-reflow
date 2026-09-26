// Troubleshooting tab: accordion list of known problems — short title in the
// header, on expand: summary, details, numbered recipe, and one-click
// treatment buttons (actions run through the App session handlers).
import { Play } from "lucide-react";
import { TROUBLES, type TroubleAction } from "../../lib/troubleshooting";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Button } from "../ui/button";

export default function TroubleshootingTab({
  leftOn,
  rightOn,
  running,
  onRun,
}: {
  leftOn: boolean;
  rightOn: boolean;
  running: string | null;
  onRun: (a: TroubleAction) => void;
}) {
  const sideOn = (s: TroubleAction["side"]) =>
    s === "left" ? leftOn : s === "right" ? rightOn : true;

  return (
    <section className="mx-auto max-w-3xl">
      <p className="mb-3 text-sm text-muted-foreground">
        Known problems of the Naya Create firmware (0.3.41.0), each with a
        proven recipe. Buttons talk to the device directly — dangerous verbs
        (factory format, erases) are deliberately text-only.
      </p>
      <Accordion type="single" collapsible className="rounded-lg border">
        {TROUBLES.map((e) => (
          <AccordionItem key={e.id} value={e.id}>
            <AccordionTrigger className="px-4 text-left text-sm font-medium">
              {e.title}
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 text-sm">
              <p className="mb-2 text-muted-foreground">{e.summary}</p>
              {e.details.map((d, i) => (
                <p key={i} className="mb-2 text-muted-foreground">
                  {d}
                </p>
              ))}
              <p className="mb-1 font-medium">Recipe</p>
              <ol className="mb-3 list-decimal space-y-1 pl-5">
                {e.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              {e.actions && e.actions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {e.actions.map((a) => (
                    <Button
                      key={a.kind}
                      variant="outline"
                      size="sm"
                      disabled={!sideOn(a.side) || running !== null}
                      title={
                        sideOn(a.side)
                          ? undefined
                          : `Connect the ${a.side} half first`
                      }
                      onClick={() => onRun(a)}
                    >
                      <Play />
                      {running === a.kind ? "Running…" : a.label}
                    </Button>
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
