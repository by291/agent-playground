import { useId, useState } from "react";
import { QuestionIcon } from "@phosphor-icons/react/dist/csr/Question";
import { HandPalmIcon } from "@phosphor-icons/react/dist/csr/HandPalm";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";
import { Item as RadioGroupOption } from "@radix-ui/react-radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  interactionResponse,
  parseAgentInteraction,
  userQuestionsSchema,
  type AgentInteraction,
  type InteractionDecision,
  type InteractionResponse,
  type UserQuestion,
} from "@shared/agent-interaction";
import { useConversation } from "../../providers/ConversationProvider";
import { isRestoring, isRunning } from "../../model/selectors";

interface QuestionDraft {
  selection: string;
  customText: string;
}

interface DecisionDraft {
  type: "" | InteractionDecision["type"];
  answers: Record<string, QuestionDraft>;
  reason: string;
}

interface InteractionPage {
  actionIndex: number;
  question?: UserQuestion;
}

interface AgentInteractionPanelProps {
  interaction: AgentInteraction;
  busy: boolean;
  onRespond: (
    interaction: AgentInteraction,
    response: InteractionResponse,
  ) => Promise<void>;
}

function answerText(question: UserQuestion, draft: QuestionDraft): string {
  if (draft.selection === "custom") {
    return draft.customText.trim();
  }

  if (!draft.selection) {
    return "";
  }

  return question.options?.[Number(draft.selection)]?.label ?? "";
}

function actionDecision(
  action: AgentInteraction["action_requests"][number],
  draft: DecisionDraft,
): InteractionDecision | null {
  if (draft.type === "approve") {
    return { type: "approve" };
  }

  if (draft.type === "reject") {
    return {
      type: "reject",
      ...(draft.reason.trim() ? { message: draft.reason.trim() } : {}),
    };
  }

  if (draft.type !== "respond") {
    return null;
  }

  const { questions } = userQuestionsSchema.parse(action.args);
  const answers = questions.map((question) => ({
    id: question.id,
    answer: answerText(question, draft.answers[question.id]!),
  }));

  if (answers.some(({ answer }) => !answer || answer.length > 4000)) {
    return null;
  }

  return { type: "respond", message: JSON.stringify({ answers }) };
}

function responseFromDrafts(
  interaction: AgentInteraction,
  drafts: DecisionDraft[],
): InteractionResponse | null {
  const decisions: InteractionDecision[] = [];

  for (const [index, action] of interaction.action_requests.entries()) {
    const decision = actionDecision(action, drafts[index]!);

    if (!decision) {
      return null;
    }

    decisions.push(decision);
  }

  const response = { decisions };

  return interactionResponse(interaction, response) ? response : null;
}

/** Keeps pending interactions adjacent to the composer while the session owns recovery. */
export function PendingAgentInteraction() {
  const { interrupts, busy, respond } = useConversation(
    useShallow((state) => ({
      interrupts: state.pendingInterrupts,
      busy: isRunning(state) || isRestoring(state),
      respond: state.respondToInteraction,
    })),
  );
  const interaction = interrupts
    .map(parseAgentInteraction)
    .find((request) => request !== null);

  if (!interaction) {
    return null;
  }

  return (
    <AgentInteractionPanel
      key={JSON.stringify(interaction)}
      interaction={interaction}
      busy={busy}
      onRespond={respond}
    />
  );
}

function QuestionFields({
  question,
  draft,
  onChange,
  inputId,
}: {
  question: UserQuestion;
  draft: QuestionDraft;
  onChange: (draft: QuestionDraft) => void;
  inputId: string;
}) {
  const customInput = !question.options || draft.selection === "custom";

  return (
    <div className="space-y-2">
      {question.options && (
        <RadioGroup
          aria-label={question.question}
          value={draft.selection}
          onValueChange={(selection) => onChange({ ...draft, selection })}
          className="gap-2"
        >
          {question.options.map((option, index) => (
            <RadioGroupOption
              key={index}
              value={String(index)}
              className="group flex min-h-12 cursor-pointer items-center gap-3 rounded-lg p-2 text-left outline-none transition-colors hover:bg-selected focus-visible:ring-2 focus-visible:ring-accent data-[state=checked]:bg-selected"
            >
              <span
                aria-hidden="true"
                data-slot="question-option-number"
                className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line text-sm text-muted group-data-[state=checked]:border-ink group-data-[state=checked]:bg-ink group-data-[state=checked]:text-surface"
              >
                {index + 1}
              </span>
              <span className="min-w-0 text-base/6 wrap-break-word text-ink">
                {option.label}
                {option.description && (
                  <span className="block text-sm/5 text-muted">
                    {option.description}
                  </span>
                )}
              </span>
            </RadioGroupOption>
          ))}
        </RadioGroup>
      )}
      {customInput && (
        <Textarea
          id={inputId}
          aria-label={`Your answer: ${question.question}`}
          placeholder="Write your answer…"
          rows={1}
          maxLength={4000}
          value={draft.customText}
          onChange={(event) =>
            onChange({ ...draft, customText: event.target.value })
          }
          className="max-h-24 min-h-10 resize-none bg-surface px-2.5 py-2 text-base sm:text-sm"
        />
      )}
    </div>
  );
}

export function AgentInteractionPanel({
  interaction,
  busy,
  onRespond,
}: AgentInteractionPanelProps) {
  const id = useId();
  const [pageIndex, setPageIndex] = useState(0);
  const [drafts, setDrafts] = useState<DecisionDraft[]>(() =>
    interaction.action_requests.map((action, index) => ({
      type:
        action.name === "ask_user" &&
        interaction.review_configs[index]!.allowed_decisions.includes("respond")
          ? "respond"
          : "",
      answers: Object.fromEntries(
        action.name === "ask_user"
          ? userQuestionsSchema
              .parse(action.args)
              .questions.map((question) => [
                question.id,
                { selection: question.options ? "" : "custom", customText: "" },
              ])
          : [],
      ),
      reason: "",
    })),
  );
  const [submitting, setSubmitting] = useState<
    InteractionDecision["type"] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const pages = interaction.action_requests.flatMap<InteractionPage>(
    (action, actionIndex) =>
      action.name === "ask_user"
        ? userQuestionsSchema
            .parse(action.args)
            .questions.map((question) => ({ actionIndex, question }))
        : [{ actionIndex }],
  );
  const page = pages[pageIndex]!;
  const action = interaction.action_requests[page.actionIndex]!;
  const config = interaction.review_configs[page.actionIndex]!;
  const draft = drafts[page.actionIndex]!;
  const question = page.question;
  const disabled = busy || submitting !== null;
  const primaryType = question ? "respond" : "approve";
  const canSubmitAction = config.allowed_decisions.includes(primaryType);
  const currentAnswer = question
    ? answerText(question, draft.answers[question.id]!)
    : null;
  const primaryDisabled =
    disabled || (question !== undefined && !currentAnswer);
  const candidateDrafts: DecisionDraft[] = drafts.map((value, index) =>
    index === page.actionIndex ? { ...value, type: primaryType } : value,
  );
  const completeResponse = responseFromDrafts(interaction, candidateDrafts);
  let primaryLabel = "Allow once";

  if (question) {
    primaryLabel = pages.length > 1 && !completeResponse ? "Next" : "Send";
  }

  const title =
    question?.question ?? `Allow ${action.name.replaceAll("_", " ")}?`;
  const decisionStatus = {
    approve: "Allowed",
    reject: "Rejected",
    respond: "",
    "": "",
  }[draft.type];

  function updateDraft(update: Partial<DecisionDraft>) {
    setDrafts((previous) =>
      previous.map((value, index) =>
        index === page.actionIndex ? { ...value, ...update } : value,
      ),
    );
    setError(null);
  }

  async function decide(type: InteractionDecision["type"]) {
    if (
      disabled ||
      !config.allowed_decisions.includes(type) ||
      (type === "respond" && !currentAnswer)
    ) {
      return;
    }

    const nextDrafts = drafts.map((value, index) =>
      index === page.actionIndex ? { ...value, type } : value,
    );
    const response = responseFromDrafts(interaction, nextDrafts);

    setDrafts(nextDrafts);
    setError(null);

    if (!response) {
      // Only explicit footer decisions authorize tools. Paging skips answered questions,
      // but a later tool remains undecided until its own approval button is pressed.
      for (let offset = 1; offset <= pages.length; offset += 1) {
        const nextIndex = (pageIndex + offset) % pages.length;
        const nextPage = pages[nextIndex]!;
        const nextDraft = nextDrafts[nextPage.actionIndex]!;

        if (
          actionDecision(
            interaction.action_requests[nextPage.actionIndex]!,
            nextDraft,
          )
        ) {
          continue;
        }

        if (
          !nextPage.question ||
          !answerText(
            nextPage.question,
            nextDraft.answers[nextPage.question.id]!,
          )
        ) {
          setPageIndex(nextIndex);
          break;
        }
      }

      return;
    }

    setSubmitting(type);

    try {
      await onRespond(interaction, response);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not submit your response. Try again.",
      );
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <section
      aria-label="Agent needs your response"
      className="motion-content-enter flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_3px_12px_rgba(32,36,44,0.04)]"
    >
      <div className="flex min-h-14 shrink-0 items-center gap-2 px-5 pt-2 text-sm text-muted">
        {question ? (
          <QuestionIcon size={19} aria-hidden="true" />
        ) : (
          <HandPalmIcon size={19} aria-hidden="true" />
        )}
        <span>{question ? "Question" : "Approval required"}</span>
        {decisionStatus && (
          <span className="ml-1 text-xs">{decisionStatus}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {pages.length > 1 && (
            <span
              className="text-xs"
              aria-label={`Request ${pageIndex + 1} of ${pages.length}`}
            >
              {pageIndex + 1} / {pages.length}
            </span>
          )}
          {question && config.allowed_decisions.includes("reject") && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close question"
              className="size-9"
              disabled={disabled}
              onClick={() => void decide("reject")}
            >
              <XIcon size={17} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      <div
        key={pageIndex}
        className="max-h-[min(24rem,48dvh)] min-h-0 overflow-y-auto overscroll-contain px-5 pt-2 pb-3"
        data-slot="interaction-body"
      >
        <div className="mb-3 flex items-start gap-3">
          <h2 className="min-w-0 flex-1 text-base/6 font-semibold wrap-break-word text-ink">
            {title}
          </h2>
        </div>
        <fieldset
          disabled={disabled || (question !== undefined && !canSubmitAction)}
          className="min-w-0 space-y-2"
        >
          <legend className="sr-only">{title}</legend>
          {question ? (
            <QuestionFields
              key={`${page.actionIndex}-${question.id}`}
              question={question}
              draft={draft.answers[question.id]!}
              inputId={`${id}-answer-${pageIndex}`}
              onChange={(answer) =>
                updateDraft({
                  type: "respond",
                  answers: { ...draft.answers, [question.id]: answer },
                })
              }
            />
          ) : (
            <>
              {action.description && (
                <p className="text-sm/6 whitespace-pre-wrap text-muted">
                  {action.description}
                </p>
              )}
              <details className="text-xs text-muted">
                <summary className="cursor-pointer py-1 font-medium">
                  Tool arguments
                </summary>
                <pre className="mt-1 max-h-32 overflow-y-auto rounded-md bg-canvas p-2 font-mono text-xs/5 whitespace-pre-wrap break-all">
                  <code className="mb-1 block">{action.name}</code>
                  {JSON.stringify(action.args, null, 2)}
                </pre>
              </details>
              {config.allowed_decisions.includes("reject") && (
                <details className="text-xs text-muted">
                  <summary className="cursor-pointer py-1">
                    Add rejection instructions
                  </summary>
                  <Textarea
                    aria-label="Reason or instructions (optional)"
                    rows={1}
                    maxLength={4000}
                    value={draft.reason}
                    onChange={(event) =>
                      updateDraft({ reason: event.target.value })
                    }
                    className="mt-1 max-h-24 min-h-10 resize-none bg-surface text-base sm:text-sm"
                  />
                </details>
              )}
            </>
          )}
        </fieldset>
      </div>

      <div
        className="flex shrink-0 flex-wrap items-center gap-2 px-5 pt-1 pb-4"
        data-slot="interaction-actions"
      >
        {pageIndex > 0 && (
          <Button
            variant="ghost"
            className="min-h-11 px-3 text-sm sm:min-h-10"
            disabled={disabled}
            onClick={() => setPageIndex(pageIndex - 1)}
          >
            Back
          </Button>
        )}
        {question?.options && (
          <Button
            variant="ghost"
            className="mr-auto min-h-11 min-w-0 justify-start px-2 text-sm text-muted sm:min-h-10"
            aria-pressed={draft.answers[question.id]!.selection === "custom"}
            disabled={disabled || !canSubmitAction}
            onClick={() =>
              updateDraft({
                type: "respond",
                answers: {
                  ...draft.answers,
                  [question.id]: {
                    ...draft.answers[question.id]!,
                    selection: "custom",
                  },
                },
              })
            }
          >
            <PencilSimpleIcon size={18} aria-hidden="true" />
            Write your own answer
          </Button>
        )}
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          {config.allowed_decisions.includes("reject") && (
            <Button
              variant="outline"
              className="min-h-11 border-line bg-surface px-4 text-sm sm:min-h-10"
              disabled={disabled}
              onClick={() => void decide("reject")}
            >
              {submitting === "reject" && <Spinner aria-hidden="true" />}
              {question ? "Skip" : "Reject"}
            </Button>
          )}
          {canSubmitAction && (
            <Button
              className="min-h-11 min-w-20 px-5 text-sm sm:min-h-10"
              disabled={primaryDisabled}
              onClick={() => void decide(primaryType)}
            >
              {submitting === primaryType && <Spinner aria-hidden="true" />}
              {primaryLabel}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="px-3 pt-1 pb-2 text-xs/5 text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
