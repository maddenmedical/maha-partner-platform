import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/queryClient";
import { openAuthedFile, downloadAuthedFile } from "@/lib/fileAccess";
import { Star, FileText, SmilePlus, Download, ListTodo, ArrowUpRightFromSquare, Trash2 } from "lucide-react";
import { EmojiPicker } from "./EmojiPicker";
import { useToast } from "@/hooks/use-toast";
import { mentionTokenRegex } from "@/lib/chatMentions";
import { UserAvatar } from "@/components/UserAvatar";
import type { ChatMessage } from "@shared/schema";

// Splits a message body around @{{id|label}} mention tokens (see
// chatMentions.ts) and renders each as a clickable jump-to-thread chip
// inline with the surrounding text.
function renderMessageBody(body: string, onNavigateToThread?: (id: number) => void) {
  const re = mentionTokenRegex();
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(body))) {
    if (match.index > last) nodes.push(body.slice(last, match.index));
    const threadId = Number(match[1]);
    const label = match[2];
    nodes.push(
      <button
        key={`mention-${key++}`}
        type="button"
        onClick={() => onNavigateToThread?.(threadId)}
        disabled={!onNavigateToThread}
        className="inline-flex items-center gap-1 mx-0.5 rounded-full border border-current/20 bg-background/40 px-2 py-0.5 text-xs font-medium align-middle hover-elevate active-elevate-2 disabled:opacity-100"
        data-testid={`link-mention-thread-${threadId}`}
      >
        <ArrowUpRightFromSquare className="h-3 w-3 shrink-0" />
        <span className="truncate max-w-[160px]">{label}</span>
      </button>
    );
    last = match.index + match[0].length;
  }
  if (last < body.length) nodes.push(body.slice(last));
  return nodes;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
  userNames: string[];
}

export interface ChatMessageWithMeta extends ChatMessage {
  flaggedByMe?: boolean;
  reactions?: Reaction[];
  senderPhotoUrl?: string | null;
}

interface ChatMessageBubbleProps {
  message: ChatMessageWithMeta;
  isMe: boolean;
  onToggleFlag: (id: number) => void;
  onReact: (id: number, emoji: string) => void;
  // Admin-only extras: downloading voice notes as mp3, handing a message
  // off to another admin as a to-do, and deleting a message. Omitted/false
  // for partner & student views.
  isAdmin?: boolean;
  onCreateTodo?: (messageId: number) => void;
  onDelete?: (messageId: number) => void;
  // Jumps the viewer to a different thread when they click an @-mention
  // chip inside this message (see chatMentions.ts). Omit to render chips
  // as plain inert labels.
  onNavigateToThread?: (threadId: number) => void;
}

export function ChatMessageBubble({ message: m, isMe, onToggleFlag, onReact, isAdmin, onCreateTodo, onDelete, onNavigateToThread }: ChatMessageBubbleProps) {
  const { toast } = useToast();
  const attachmentSrc = m.attachmentUrl ? `${API_BASE}${m.attachmentUrl}` : null;
  const isDeleted = !!m.deletedAt;

  function handleOpenAttachment() {
    if (!m.attachmentUrl) return;
    openAuthedFile(m.attachmentUrl).catch((e) =>
      toast({ title: "Could not open attachment", description: e.message, variant: "destructive" })
    );
  }

  function handleDownloadMp3() {
    if (!m.attachmentUrl) return;
    const driveFileId = m.attachmentUrl.split("/").pop();
    if (!driveFileId) return;
    const filename = (m.attachmentName || "voice-note").replace(/\.[^.]+$/, "");
    downloadAuthedFile(`/api/admin/files/${driveFileId}/download-mp3`, `${filename}.mp3`).catch((e) =>
      toast({ title: "Could not download mp3", description: e.message, variant: "destructive" })
    );
  }

  if (isDeleted) {
    return (
      <div
        className={cn("group flex flex-col max-w-[80%]", isMe ? "self-end items-end" : "self-start items-start")}
        data-testid={`message-${m.id}`}
      >
        <div className="rounded-lg px-3 py-2 text-sm italic text-muted-foreground bg-muted/50 border border-dashed border-border">
          This message was deleted{isAdmin && m.deletedByName ? ` by ${m.deletedByName}` : ""}.
        </div>
        <span className="text-xs text-muted-foreground mt-1 px-1">
          {isMe ? "You" : m.senderName} · {format(new Date(m.createdAt), "MMM d, HH:mm")}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn("group flex flex-col max-w-[80%]", isMe ? "self-end items-end" : "self-start items-start")}
      data-testid={`message-${m.id}`}
    >
      <div className="flex items-start gap-1">
        {!isMe && <UserAvatar photoUrl={m.senderPhotoUrl} name={m.senderName} size="sm" className="mt-1" />}
        {!isMe && <ReactionTrigger messageId={m.id} onReact={onReact} order="before" />}
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm flex flex-col gap-1.5",
            isMe ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
          )}
        >
          {attachmentSrc && m.attachmentType === "image" && (
            <img
              src={attachmentSrc}
              alt={m.attachmentName || "attachment"}
              className="max-w-[240px] max-h-64 rounded-md object-cover cursor-pointer"
              onClick={handleOpenAttachment}
              data-testid={`img-attachment-${m.id}`}
            />
          )}
          {attachmentSrc && m.attachmentType === "video" && (
            <video controls src={attachmentSrc} className="max-w-[240px] max-h-64 rounded-md" data-testid={`video-attachment-${m.id}`} />
          )}
          {attachmentSrc && m.attachmentType === "audio" && (
            <div className="flex items-center gap-1.5">
              <audio controls src={attachmentSrc} className="max-w-[220px]" data-testid={`audio-attachment-${m.id}`} />
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleDownloadMp3}
                  title="Download as MP3"
                  aria-label="Download as MP3"
                  className={cn(
                    "shrink-0 rounded-md p-1 hover-elevate active-elevate-2",
                    isMe ? "text-primary-foreground/80" : "text-muted-foreground"
                  )}
                  data-testid={`button-download-mp3-${m.id}`}
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {attachmentSrc && m.attachmentType === "document" && (
            <button
              type="button"
              onClick={handleOpenAttachment}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover-elevate active-elevate-2",
                isMe ? "bg-primary-foreground/10" : "bg-background"
              )}
              data-testid={`document-attachment-${m.id}`}
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate text-xs">{m.attachmentName || "Document"}</span>
            </button>
          )}
          {m.body && (
            <span className="whitespace-pre-wrap break-words">{renderMessageBody(m.body, onNavigateToThread)}</span>
          )}
        </div>
        {isMe && <ReactionTrigger messageId={m.id} onReact={onReact} order="after" />}
        <button
          type="button"
          onClick={() => onToggleFlag(m.id)}
          className={cn(
            "shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity",
            m.flaggedByMe && "opacity-100"
          )}
          data-testid={`button-flag-${m.id}`}
          aria-label={m.flaggedByMe ? "Unflag message" : "Flag message"}
        >
          <Star className={cn("h-3.5 w-3.5", m.flaggedByMe ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
        </button>
        {isAdmin && onCreateTodo && (
          <button
            type="button"
            onClick={() => onCreateTodo(m.id)}
            className="shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground"
            data-testid={`button-create-todo-${m.id}`}
            aria-label="Create to-do from this message"
            title="Create to-do for another admin"
          >
            <ListTodo className="h-3.5 w-3.5" />
          </button>
        )}
        {isAdmin && onDelete && (
          <button
            type="button"
            onClick={() => onDelete(m.id)}
            className="shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            data-testid={`button-delete-message-${m.id}`}
            aria-label="Delete message"
            title="Delete message"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {!!m.reactions?.length && (
        <div className={cn("flex gap-1 mt-1 flex-wrap", isMe ? "justify-end" : "justify-start")}>
          {m.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => onReact(m.id, r.emoji)}
              title={r.userNames.join(", ")}
              className={cn(
                "text-xs rounded-full px-1.5 py-0.5 border flex items-center gap-1 hover-elevate active-elevate-2",
                r.mine ? "border-primary bg-primary/10" : "border-border bg-card"
              )}
              data-testid={`reaction-pill-${m.id}-${r.emoji}`}
            >
              <span>{r.emoji}</span>
              <span className="text-muted-foreground">{r.count}</span>
            </button>
          ))}
        </div>
      )}

      <span className="text-xs text-muted-foreground mt-1 px-1">
        {isMe ? "You" : m.senderName} · {format(new Date(m.createdAt), "MMM d, HH:mm")}
      </span>
    </div>
  );
}

function ReactionTrigger({
  messageId,
  onReact,
  order,
}: {
  messageId: number;
  onReact: (id: number, emoji: string) => void;
  order: "before" | "after";
}) {
  return (
    <EmojiPicker
      onSelect={(emoji) => onReact(messageId, emoji)}
      align={order === "before" ? "start" : "end"}
      testId={`button-react-${messageId}`}
      trigger={
        <button
          type="button"
          className="opacity-0 group-hover:opacity-100 transition-opacity mt-1.5 rounded-full p-1 hover-elevate active-elevate-2 text-muted-foreground"
          aria-label="React to message"
          data-testid={`button-react-${messageId}`}
        >
          <SmilePlus className="h-3.5 w-3.5" />
        </button>
      }
    />
  );
}
