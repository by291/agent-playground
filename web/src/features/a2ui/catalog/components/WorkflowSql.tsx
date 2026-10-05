import { createComponentImplementation } from "@a2ui/react/v0_9";
import { sqlCardSchema, type SqlCard } from "@shared/sql-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";

export function SqlCardContent({ card }: { card: SqlCard }) {
  let status = card.check.passed ? "Check passed" : "Changes required";

  if (card.status === "submitted") {
    status = "SQL submitted";
  } else if (card.status === "abandoned") {
    status = "SQL abandoned";
  }

  return (
    <section aria-label="SQL workflow" className="motion-item-enter min-w-0">
      <Card className="min-w-0 gap-4 py-4 sm:py-5">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2 sm:px-5">
          <h3 className="text-base font-semibold text-ink">SQL review</h3>
          <Badge
            variant="secondary"
            key={`${card.revision}-${card.status}`}
            className="motion-content-enter text-xs font-medium text-accent"
          >
            Version {card.revision} · {status}
          </Badge>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4 sm:px-5">
          <pre className="max-h-80 overflow-auto rounded-md border border-line bg-sidebar p-3 text-sm/6 text-ink">
            <code>{card.sql}</code>
          </pre>
          {card.check.issues.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-5 text-sm/6">
                  {card.check.issues.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <Collapsible className="text-xs/5 text-muted">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="group -ml-2 text-xs text-muted"
              >
                Original SQL
                <CaretDownIcon
                  aria-hidden="true"
                  className="motion-chevron group-data-[state=open]:rotate-180"
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap">
                <code>{card.originalSql}</code>
              </pre>
            </CollapsibleContent>
          </Collapsible>
          {card.receiptId && (
            <p className="break-all text-xs/5 text-muted">
              Receipt: {card.receiptId}
            </p>
          )}
          {card.status === "abandoned" && (
            <p className="text-sm text-muted">Nothing was submitted.</p>
          )}
          <p className="text-xs/5 text-soft">
            Demo checks only. Submission records SQL without executing it.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

export const WorkflowSql = createComponentImplementation(
  { name: "WorkflowSql", schema: sqlCardSchema.strict() },
  ({ props }) => <SqlCardContent card={props} />,
);
