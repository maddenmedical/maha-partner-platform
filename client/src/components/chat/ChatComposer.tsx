import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, API_BASE } from "@/lib/queryClient";
import { EmojiPicker } from "./EmojiPicker";
import { Send, Loader2, Paperclip, Mic, Square, X, FileText, Image as ImageIcon, Stethoscope, MessageSquare, Plus, Reply } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { type MentionCandidate, findActiveMention, formatMentionToken, newChatMentionLabel } from "@/lib/chatMentions";

function mentionCandidateLabel(candidate: MentionCandidate, query: string): string {
  return candidate.type === "new" ? newChatMentionLabel(query) : candidate.label;
}

export interface PendingAttachment {
  url: string;
  name: string;
  mimeType: string;
  type: "image" | "video" | "audio" | "document";
}

export interface ReplyContext {
  id: number;
  senderName: string;
  snippet: string;
}

interface ChatComposerProps {
  uploadUrl: string;
  threadId: number;
  onSend: (payload: { body: string; attachmentUrl?: string; attachmentType?: string; attachmentName?: string; replyToMessageId?: number }) => Promise<unknown> | unknown;
  sending?: boolean;
  testIdPrefix?: string;
  disableAttachments?: boolean;
  replyingTo?: ReplyContext | null;
  onCancelReply?: () => void;
  // Other chats (and unlinked referrals) with the same partner that "@" can
  // reference -- typing "@" and picking one drops in a jump-link the reader
  // can click to switch straight to that conversation. Omit or pass [] to
  // disable. A "start new chat" option is appended automatically whenever
  // `onResolveMention` is provided, so callers don't need to include it.
  mentionThreads?: MentionCandidate[];
  // Creates (or looks up) the real chat thread behind a "referral" or "new"
  // mention candidate, returning the id/label to insert as the token. Not
  // called for "thread" candidates, which resolve locally with no network
  // round-trip. Required for "referral"/"new" candidates to be selectable;
  // omit to only offer direct thread jumps.
  onResolveMention?: (candidate: MentionCandidate, query: string) => Promise<{ id: number; label: string }>;
  // Overrides the default composer placeholder. Use this when the mention
  // feature ("@ to link another chat") is not wired up for this surface --
  // the default text would otherwise advertise a feature that does nothing.
  placeholder?: string;
}

// Voice notes are always recorded as real audio via MediaRecorder and sent as
// a normal audio attachment the recipient can play back -- no speech-to-text,
// no transcription. Server-side transcription (Whisper) is out of scope.
export function ChatComposer({ uploadUrl, threadId, onSend, sending, testIdPrefix = "chat", disableAttachments, replyingTo, onCancelReply, mentionThreads = [], onResolveMention, placeholder }: ChatComposerProps) {
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [recording, setRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [mentionResolving, setMentionResolving] = useState(false);

  const mentionMatches: MentionCandidate[] = mention
    ? [
        ...mentionThreads
          .filter((c) => c.type !== "new")
          .filter((c) => mentionCandidateLabel(c, mention.query).toLowerCase().includes(mention.query.toLowerCase()))
          .slice(0, 5),
        // Always-available fallback action, appended last -- lets a partner
        // start a brand new chat right from the mention flow instead of
        // backing out to a separate "New chat" button.
        ...(onResolveMention ? [{ type: "new" } as MentionCandidate] : []),
      ]
    : [];

  function applyBodyChange(nextBody: string, caret: number) {
    setBody(nextBody);
    const active = findActiveMention(nextBody, caret);
    setMention(active);
    setMentionActiveIndex(0);
  }

  async function selectMention(candidate: MentionCandidate) {
    const activeMention = mention;
    if (!activeMention || mentionResolving) return;
    let target: { id: number; label: string };
    if (candidate.type === "thread") {
      target = { id: candidate.id, label: candidate.label };
    } else {
      if (!onResolveMention) return;
      setMentionResolving(true);
      try {
        target = await onResolveMention(candidate, activeMention.query);
      } catch (err) {
        toast({
          title: "Couldn't start that chat",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
        setMentionResolving(false);
        return;
      }
      setMentionResolving(false);
    }
    const token = formatMentionToken(target.id, target.label) + " ";
    const caret = activeMention.start + token.length;
    const nextBody =
      body.slice(0, activeMention.start) + token + body.slice(activeMention.start + 1 + activeMention.query.length);
    setBody(nextBody);
    setMention(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  }

  async function uploadFile(file: File): Promise<PendingAttachment> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("threadId", String(threadId));
    const res = await apiRequest("POST", uploadUrl, formData, true);
    return res.json();
  }

  async function handleFilePicked(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadFile(file);
      setPendingAttachment(uploaded);
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function startAudioRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const ext = blob.type.includes("mp4") ? "m4a" : "webm";
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: blob.type });
        setUploading(true);
        try {
          const uploaded = await uploadFile(file);
          setPendingAttachment(uploaded);
        } catch (e: any) {
          toast({ title: "Could not save voice note", description: e.message, variant: "destructive" });
        } finally {
          setUploading(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast({ title: "Microphone access denied", description: "Allow microphone access to record a voice note.", variant: "destructive" });
    }
  }

  function stopAudioRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }

  function handleMicClick() {
    if (recording) {
      stopAudioRecording();
      return;
    }
    startAudioRecording();
  }

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop?.();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() && !pendingAttachment) return;
    await onSend({
      body: body.trim(),
      attachmentUrl: pendingAttachment?.url,
      attachmentType: pendingAttachment?.type,
      attachmentName: pendingAttachment?.name,
      replyToMessageId: replyingTo?.id,
    });
    setBody("");
    setPendingAttachment(null);
    setMention(null);
    onCancelReply?.();
  }

  const busy = uploading || sending || recording;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-t border-border pt-3">
      {replyingTo && (
        <div
          className="flex items-center gap-2 rounded-md border-l-2 border-primary bg-muted/50 px-2.5 py-1.5 text-xs"
          data-testid={`${testIdPrefix}-reply-preview`}
        >
          <Reply className="h-3.5 w-3.5 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-primary truncate" data-testid={`${testIdPrefix}-reply-preview-name`}>{replyingTo.senderName}</p>
            <p className="text-muted-foreground truncate">{replyingTo.snippet}</p>
          </div>
          <button type="button" onClick={onCancelReply} data-testid={`button-${testIdPrefix}-cancel-reply`} aria-label="Cancel reply">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {pendingAttachment && (
        <div
          className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs"
          data-testid={`${testIdPrefix}-pending-attachment`}
        >
          {pendingAttachment.type === "image" && <ImageIcon className="h-3.5 w-3.5 shrink-0" />}
          {pendingAttachment.type === "document" && <FileText className="h-3.5 w-3.5 shrink-0" />}
          {pendingAttachment.type === "audio" && <Mic className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate flex-1">{pendingAttachment.name}</span>
          {pendingAttachment.type === "audio" && (
            <audio controls src={`${API_BASE}${pendingAttachment.url}`} className="h-6 max-w-[140px]" />
          )}
          <button type="button" onClick={() => setPendingAttachment(null)} data-testid={`${testIdPrefix}-remove-attachment`} aria-label="Remove attachment">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {recording && (
        <p className="text-xs text-primary flex items-center gap-1.5">
          <RecordingDot />
          Recording voice note... tap the mic again to stop.
        </p>
      )}
      <div className="flex items-end gap-1 relative">
        {mention && (
          <div
            className="absolute bottom-full left-24 mb-1 w-64 max-h-56 overflow-y-auto rounded-lg border border-card-border bg-popover shadow-md py-1 z-30"
            data-testid={`${testIdPrefix}-mention-list`}
          >
            {mentionResolving ? (
              <p className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting chat...
              </p>
            ) : mentionMatches.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No other chats with this partner yet.</p>
            ) : (
              mentionMatches.map((c, i) => {
                const testKey = c.type === "thread" ? `thread-${c.id}` : c.type === "referral" ? `referral-${c.referralId}` : "new";
                return (
                  <button
                    key={testKey}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectMention(c);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover-elevate active-elevate-2",
                      i === mentionActiveIndex && "bg-accent"
                    )}
                    data-testid={`${testIdPrefix}-mention-option-${testKey}`}
                  >
                    {c.type === "new" ? (
                      <Plus className="h-3.5 w-3.5 text-primary shrink-0" />
                    ) : c.type === "referral" || (c.type === "thread" && c.kind === "referral") ? (
                      <Stethoscope className="h-3.5 w-3.5 text-primary shrink-0" />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="truncate">{mentionCandidateLabel(c, mention?.query ?? "")}</span>
                  </button>
                );
              })
            )}
          </div>
        )}
        {!disableAttachments && (
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            onChange={(e) => handleFilePicked(e.target.files?.[0] || null)}
            data-testid={`input-${testIdPrefix}-attachment`}
          />
        )}
        {!disableAttachments && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            data-testid={`button-${testIdPrefix}-attach`}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </Button>
        )}
        <EmojiPicker onSelect={(e) => setBody((b) => b + e)} testId={`button-${testIdPrefix}-emoji`} />
        {!disableAttachments && (
          <Button
            type="button"
            variant={recording ? "destructive" : "ghost"}
            size="icon"
            className="shrink-0"
            disabled={uploading || sending}
            onClick={handleMicClick}
            data-testid={`button-${testIdPrefix}-mic`}
          >
            {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        )}
        <Textarea
          ref={textareaRef}
          value={body}
          disabled={mentionResolving}
          onChange={(e) => applyBodyChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          placeholder={placeholder ?? "Type a message... (@ to link another chat)"}
          rows={1}
          className="resize-none min-h-9"
          onKeyDown={(e) => {
            if (mentionResolving) {
              e.preventDefault();
              return;
            }
            if (mention && mentionMatches.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionActiveIndex((i) => (i + 1) % mentionMatches.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionActiveIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                selectMention(mentionMatches[mentionActiveIndex]);
                return;
              }
            }
            if (e.key === "Escape" && mention) {
              e.preventDefault();
              setMention(null);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e as unknown as React.FormEvent);
            }
          }}
          data-testid={`textarea-${testIdPrefix}-message`}
        />
        <Button
          type="submit"
          size="icon"
          disabled={sending || uploading || (!body.trim() && !pendingAttachment)}
          data-testid={`button-${testIdPrefix}-send`}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </form>
  );
}

function RecordingDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
    </span>
  );
}
