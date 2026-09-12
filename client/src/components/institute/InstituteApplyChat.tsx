import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { MahaLogo } from "@/components/MahaLogo";
import { Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { cn, getGreetingName } from "@/lib/utils";
import { setPendingThreadId } from "@/lib/chatNav";
import { questionsFor, type Question } from "./instituteQuestions";

type Specialty = "Medical" | "Dental";

interface Turn {
  id: string;
  sender: "bot" | "user";
  text: string;
  helper?: string;
}

const SPECIALTY_QUESTION_LABEL = "What is your specialty?";

function BotBubble({ text, helper }: { text: string; helper?: string }) {
  return (
    <div className="flex items-start gap-2 max-w-[85%]">
      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <MahaLogo size={16} className="text-primary" />
      </div>
      <div className="rounded-lg rounded-tl-sm bg-muted px-3 py-2">
        <p className="text-sm leading-relaxed">{text}</p>
        {helper && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{helper}</p>}
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-primary text-primary-foreground px-3 py-2">
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{text}</p>
      </div>
    </div>
  );
}

export function InstituteApplyChat({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [specialty, setSpecialty] = useState<Specialty | null>(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [answers, setAnswers] = useState<{ question: string; answer: string }[]>([]);
  const [phase, setPhase] = useState<"chat" | "submitting" | "done" | "error">("chat");
  const [threadId, setThreadId] = useState<number | null>(null);

  const [textValue, setTextValue] = useState("");
  const [multiValue, setMultiValue] = useState<string[]>([]);

  const greetingName = user ? getGreetingName(user) : "";

  // Reset every time the dialog is (re)opened, so a closed-and-reopened
  // questionnaire always starts fresh.
  useEffect(() => {
    if (!open) return;
    setSpecialty(null);
    setStepIndex(-1);
    setAnswers([]);
    setPhase("chat");
    setThreadId(null);
    setTextValue("");
    setMultiValue([]);
    setTurns([
      {
        id: "intro",
        sender: "bot",
        text: `Hi${greetingName ? ` ${greetingName}` : ""}! I'll ask you a few quick questions so Dr. Perko's team can get to know you before your first conversation — there's no need to write an email.`,
      },
      { id: "specialty", sender: "bot", text: SPECIALTY_QUESTION_LABEL },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, phase]);

  const submitMutation = useMutation({
    mutationFn: async (payload: { specialty: Specialty; answers: { question: string; answer: string }[] }) =>
      apiRequest("POST", "/api/chat/institute-application", payload),
    onSuccess: async (res) => {
      const data = await res.json();
      setThreadId(data.threadId);
      setPhase("done");
      // The chat threads list is cached with staleTime: Infinity and is
      // already populated by MobileAppLayout's unread-badge poll, so the
      // newly created thread would otherwise be invisible to Chat.tsx's
      // pending-thread auto-select until that poll's next 15s tick.
      // Invalidate now so the hand-off to /chat is instant.
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    },
    onError: () => setPhase("error"),
  });

  function pushTurn(turn: Turn) {
    setTurns((prev) => [...prev, turn]);
  }

  function handlePickSpecialty(value: Specialty) {
    pushTurn({ id: `specialty-answer`, sender: "user", text: value });
    setSpecialty(value);
    setAnswers((prev) => [...prev, { question: SPECIALTY_QUESTION_LABEL, answer: value }]);
    const questions = questionsFor(value);
    setStepIndex(0);
    pushTurn({ id: `q-0`, sender: "bot", text: questions[0].label, helper: questions[0].helper });
  }

  function finish(finalAnswers: { question: string; answer: string }[]) {
    pushTurn({
      id: "wrap-up",
      sender: "bot",
      text: `That's everything — thank you! I'm sending this straight to Dr. Perko's team now. One of our admins will pick up the conversation with you personally, right here in chat.`,
    });
    submitApplication(finalAnswers);
  }

  function submitApplication(finalAnswers: { question: string; answer: string }[]) {
    setPhase("submitting");
    submitMutation.mutate({ specialty: specialty as Specialty, answers: finalAnswers });
  }

  function advance(answerText: string, questionLabel: string) {
    const nextAnswers = [...answers, { question: questionLabel, answer: answerText }];
    setAnswers(nextAnswers);
    const questions = questionsFor(specialty as Specialty);
    const nextIndex = stepIndex + 1;
    setTextValue("");
    setMultiValue([]);
    if (nextIndex < questions.length) {
      setStepIndex(nextIndex);
      pushTurn({ id: `q-${nextIndex}`, sender: "bot", text: questions[nextIndex].label, helper: questions[nextIndex].helper });
    } else {
      finish(nextAnswers);
    }
  }

  function handleAnswerText(question: Question) {
    const value = textValue.trim();
    if (!value) return;
    pushTurn({ id: `a-${question.id}`, sender: "user", text: value });
    advance(value, question.label);
  }

  function handleAnswerChoice(question: Question, option: string) {
    pushTurn({ id: `a-${question.id}`, sender: "user", text: option });
    advance(option, question.label);
  }

  function handleAnswerMulti(question: Question) {
    if (multiValue.length === 0) return;
    const value = multiValue.join(", ");
    pushTurn({ id: `a-${question.id}`, sender: "user", text: value });
    advance(value, question.label);
  }

  function handleAnswerScale(question: Question, n: number) {
    pushTurn({ id: `a-${question.id}`, sender: "user", text: String(n) });
    advance(String(n), question.label);
  }

  function toggleMulti(option: string) {
    setMultiValue((prev) => (prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]));
  }

  function goToChat() {
    if (threadId) setPendingThreadId(threadId);
    onOpenChange(false);
    setLocation("/chat");
  }

  const currentQuestion: Question | null = specialty && phase === "chat" ? questionsFor(specialty)[stepIndex] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 flex flex-col max-h-[85vh]">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-base">MAHA Institute Application</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 flex flex-col gap-3 min-h-[320px]">
          {turns.map((t) =>
            t.sender === "bot" ? (
              <BotBubble key={t.id} text={t.text} helper={t.helper} />
            ) : (
              <UserBubble key={t.id} text={t.text} />
            )
          )}

          {phase === "submitting" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground pl-9">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending to the MAHA Institute team...
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col gap-2 pl-9">
              <p className="text-sm text-destructive">Something went wrong sending your application. Please try again.</p>
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => submitApplication(answers)}
                data-testid="button-institute-apply-retry"
              >
                Retry
              </Button>
            </div>
          )}

          {phase === "done" && (
            <div className="flex items-start gap-2 max-w-[90%]" data-testid="text-institute-apply-done">
              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 className="h-4 w-4 text-primary" />
              </div>
              <div className="rounded-lg rounded-tl-sm bg-primary/10 px-3 py-2">
                <p className="text-sm leading-relaxed">
                  All set! You'll find this conversation in your Chat tab — an admin will continue it with you there.
                </p>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="border-t border-border p-3 shrink-0">
          {stepIndex === -1 && phase === "chat" && (
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => handlePickSpecialty("Medical")} data-testid="button-institute-specialty-medical">
                Medical professional
              </Button>
              <Button className="flex-1" onClick={() => handlePickSpecialty("Dental")} data-testid="button-institute-specialty-dental">
                Dental professional
              </Button>
            </div>
          )}

          {currentQuestion && currentQuestion.type === "choice" && (
            <div className="flex flex-col gap-1.5">
              {currentQuestion.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleAnswerChoice(currentQuestion, option)}
                  className="text-left text-sm rounded-md border border-card-border px-3 py-2 hover-elevate active-elevate-2"
                  data-testid={`button-institute-choice-${option.slice(0, 12).toLowerCase().replace(/[^a-z]+/g, "-")}`}
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {currentQuestion && currentQuestion.type === "multi" && (
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-2">
                {currentQuestion.options.map((option) => (
                  <div key={option} className="flex items-start gap-2">
                    <Checkbox
                      id={`multi-${option}`}
                      checked={multiValue.includes(option)}
                      onCheckedChange={() => toggleMulti(option)}
                      className="mt-0.5"
                      data-testid={`checkbox-institute-${option.slice(0, 12).toLowerCase().replace(/[^a-z]+/g, "-")}`}
                    />
                    <Label htmlFor={`multi-${option}`} className="font-normal text-sm leading-relaxed">
                      {option}
                    </Label>
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                className="self-end gap-1.5"
                disabled={multiValue.length === 0}
                onClick={() => handleAnswerMulti(currentQuestion)}
                data-testid="button-institute-continue"
              >
                Continue <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {currentQuestion && currentQuestion.type === "scale" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
                <span>{currentQuestion.minLabel}</span>
                <span>{currentQuestion.maxLabel}</span>
              </div>
              <div className="grid grid-cols-6 sm:grid-cols-11 gap-1.5">
                {Array.from({ length: currentQuestion.max - currentQuestion.min + 1 }, (_, i) => currentQuestion.min + i).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => handleAnswerScale(currentQuestion, n)}
                    className="rounded-md border border-card-border text-sm py-1.5 hover-elevate active-elevate-2 tabular-nums"
                    data-testid={`button-institute-scale-${n}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {currentQuestion && currentQuestion.type === "text" && (
            <div className="flex flex-col gap-2">
              {currentQuestion.long ? (
                <Textarea
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  placeholder="Type your answer..."
                  rows={3}
                  autoFocus
                  data-testid="input-institute-answer"
                />
              ) : (
                <Input
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  placeholder="Type your answer..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAnswerText(currentQuestion);
                    }
                  }}
                  data-testid="input-institute-answer"
                />
              )}
              <Button
                size="sm"
                className="self-end gap-1.5"
                disabled={!textValue.trim()}
                onClick={() => handleAnswerText(currentQuestion)}
                data-testid="button-institute-continue"
              >
                Continue <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {phase === "done" && (
            <Button className="w-full" onClick={goToChat} data-testid="button-institute-go-to-chat">
              Continue in Chat
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
