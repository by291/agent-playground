import { Alert, AlertDescription } from "../ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Field, FieldContent, FieldDescription, FieldTitle } from "../ui/field";
import { Spinner } from "../ui/spinner";

export function ClearConversationsDialog({
  id,
  confirmationOpen,
  changeConfirmationOpen,
  clearing,
  clearError,
  clearConversations,
}: {
  id: string;
  confirmationOpen: boolean;
  changeConfirmationOpen: (open: boolean) => void;
  clearing: boolean;
  clearError: string | null;
  clearConversations: () => Promise<void>;
}) {
  return (
    <AlertDialog open={confirmationOpen} onOpenChange={changeConfirmationOpen}>
      <section
        aria-labelledby={`${id}-history-title`}
        className="mt-5 border-t border-line pt-5"
      >
        <Field
          orientation="responsive"
          className="sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <FieldContent>
            <FieldTitle id={`${id}-history-title`}>
              Saved conversations
            </FieldTitle>
            <FieldDescription className="text-xs/5">
              Remove every saved conversation from this shared workspace.
            </FieldDescription>
          </FieldContent>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-full shrink-0 text-destructive sm:w-44"
            >
              Clear all conversations
            </Button>
          </AlertDialogTrigger>
        </Field>
      </section>
      <AlertDialogContent
        className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-md"
        aria-busy={clearing}
        onEscapeKeyDown={(event) => {
          if (clearing) {
            event.preventDefault();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Clear all conversations?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove every saved conversation from this shared
            workspace. This cannot be undone in the app. Your preferences will
            be kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-xs/5 text-muted">
          Running or unconfirmed conversations must finish first.
        </p>
        {clearError && (
          <Alert variant="destructive">
            <AlertDescription>{clearError}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={clearing}
            onClick={(event) => {
              // The request owns closing so errors remain available for retry.
              event.preventDefault();
              void clearConversations();
            }}
          >
            {clearing && <Spinner aria-hidden="true" />}
            {clearing ? "Clearing…" : "Delete all conversations"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
