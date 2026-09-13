import { useRef, useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/queryClient";
import { openAuthedFile, downloadAuthedFile } from "@/lib/fileAccess";
import { Star, FileText, SmilePlus, Download, ListTodo, ArrowUpRightFromSquare, Trash2, Pencil, Check, X, MoreVertical } from "lucide-react";
import { EmojiPicker, QUICK_EMOJIS } from "./EmojiPicker";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose } from "@/components/ui/drawer";
import { useToast } from "@/hooks/use-toast";
import { mentionTokenRegex } from "@/lib/chatMentions";
import { UserAvatar } from "@/components/UserAvatar";
import type { ChatMessage } from "@shared/schema";

// Long-press threshold before the mobile action sheet opens, and the max
// finger movement (px) still counted as a "hold" rather than a scroll/drag
// -- mirrors the WhatsApp/Telegram/iMessage long-press-for-actions pattern,
// since on touch screens the old hover-revealed icon row (Star/Edit/To-do/
// Delete crammed into a few px) has no equivalent "hover" and ends up tiny
// and hard to hit precisely. Desktop keeps the hover icons (see `sm:` guards
// below) and also gets long-press for free since pointer events cover mice.
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

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
  // Admin editing their OWN message only -- the caller (AdminChatInbox) is
  // responsible for only wiring this up when isMe && isAdmin, since the
  // backend also rejects edits to anyone else's message.
  onEdit?: (messageId: number, body: string) => Promise<unknown> | void;
  // Jumps the viewer to a different thread when they click an @-mention
  // chip inside this message (see chatMentions.ts). Omit to render chips
  // as plain inert labels.
  onNavigateToThread?: (threadId: number) => void;
}

export function ChatMessageBubble({ message: m, isMe, onToggleFlag, onReact, isAdmin, onCreateTodo, onDelete, onEdit, onNavigateToThread }: ChatMessageBubbleProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(m.body || "");
  const [saving, setSaving] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const attachmentSrc = m.attachmentUrl ? `${API_BASE}${m.attachmentUrl}` : null;
  const isDeleted = !!m.deletedAt;

  // Long-press-to-open-actions (touch only -- desktop keeps the existing
  // hover-reveal icon row). Tracks a press-start point so a finger dragging
  // to scroll the thread cancels the timer instead of popping the sheet.
  const pressTimerRef = useRef<number | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);

  function clearPressTimer() {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressStartRef.current = null;
  }

  function handleBubblePointerDown(e: React.PointerEvent) {
    if (e.pointerType !== "touch" || isEditing) return;
    pressStartRef.current = { x: e.clientX, y: e.clientY };
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null;
      setActionSheetOpen(true);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { navigator.vibrate(10); } catch { /* no-op */ }
      }
    }, LONG_PRESS_MS);
  }

  function handleBubblePointerMove(e: React.PointerEvent) {
    if (!pressStartRef.current) return;
    const dx = Math.abs(e.clientX - pressStartRef.current.x);
    const dy = Math.abs(e.clientY - pressStartRef.current.y);
    if (dx > LONG_PRESS_MOVE_TOLERANCE_PX || dy > LONG_PRESS_MOVE_TOLERANCE_PX) clearPressTimer();
  }

  function startEdit() {
    setEditValue(m.body || "");
    setIsEditing(true);
  }

  async function saveEdit() {
    const trimmed = editValue.trim();
    if (!trimmed || !onEdit) return;
    setSaving(true);
    try {
      await onEdit(m.id, trimmed);
      setIsEditing(false);
    } catch (e: any) {
      toast({ title: "Could not save edit", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

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
        {!isMe && (
          <div className="hidden sm:block">
            <ReactionTrigger messageId={m.id} onReact={onReact} order="before" />
          </div>
        )}
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm flex flex-col gap-1.5 touch-manipulation",
            isMe ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
          )}
          onPointerDown={handleBubblePointerDown}
          onPointerMove={handleBubblePointerMove}
          onPointerUp={clearPressTimer}
          onPointerLeave={clearPressTimer}
          onPointerCancel={clearPressTimer}
          onContextMenu={(e) => e.preventDefault()}
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
          {isEditing ? (
            <div className="flex flex-col gap-1.5 min-w-[200px]">
              <Textarea
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    saveEdit();
                  } else if (e.key === "Escape") {
                    setIsEditing(false);
                  }
                }}
                rows={2}
                className={cn("text-sm resize-none", isMe ? "bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/60" : "bg-background")}
                data-testid={`textarea-edit-message-${m.id}`}
              />
              <div className="flex items-center gap-1.5 self-end">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className={cn("rounded-md p-1 hover-elevate active-elevate-2", isMe ? "text-primary-foreground/80" : "text-muted-foreground")}
                  aria-label="Cancel edit"
                  data-testid={`button-cancel-edit-${m.id}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={saving || !editValue.trim()}
                  className={cn("rounded-md p-1 hover-elevate active-elevate-2 disabled:opacity-50", isMe ? "text-primary-foreground/80" : "text-muted-foreground")}
                  aria-label="Save edit"
                  data-testid={`button-save-edit-${m.id}`}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            m.body && (
              <span className="whitespace-pre-wrap break-words">
                {renderMessageBody(m.body, onNavigateToThread)}
                {!!m.editedAt && <span className={cn("text-xs italic ml-1", isMe ? "text-primary-foreground/70" : "text-muted-foreground")}>(edited)</span>}
              </span>
            )
          )}
        </div>
        {/* Desktop-only hover-reveal action row. On touch screens there is no
            hover state, so these end up tiny, cramped, and inconsistently
            visible -- touch users get the long-press action sheet below
            instead (opened from the bubble's onPointerDown handler). */}
        <div className="hidden sm:flex sm:items-center">
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
          {isAdmin && isMe && onEdit && !isEditing && (
            <button
              type="button"
              onClick={startEdit}
              className="shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground"
              data-testid={`button-edit-message-${m.id}`}
              aria-label="Edit message"
              title="Edit message"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
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
        {/* Mobile-only: tap-and-hold indicator so touch users discover the
            long-press gesture without a permanently-visible icon row. */}
        <button
          type="button"
          onClick={() => setActionSheetOpen(true)}
          className="sm:hidden shrink-0 mt-1 rounded-full p-1 text-muted-foreground/60"
          aria-label="Message options"
          data-testid={`button-mobile-actions-${m.id}`}
        >
          {m.flaggedByMe ? (
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          ) : (
            <MoreVertical className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <Drawer open={actionSheetOpen} onOpenChange={setActionSheetOpen}>
        <DrawerContent data-testid={`sheet-message-actions-${m.id}`}>
          <DrawerHeader className="pb-1">
            <DrawerTitle className="text-sm">Message options</DrawerTitle>
            <DrawerDescription className="sr-only">React to, star, or manage this message</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-2">
            <div className="grid grid-cols-6 gap-1">
              {QUICK_EMOJIS.slice(0, 12).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    onReact(m.id, e);
                    setActionSheetOpen(false);
                  }}
                  className="text-2xl rounded-md p-2 hover-elevate active-elevate-2"
                  data-testid={`sheet-react-${m.id}-${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col border-t border-border">
            <button
              type="button"
              onClick={() => {
                onToggleFlag(m.id);
                setActionSheetOpen(false);
              }}
              className="flex items-center gap-3 px-4 py-3.5 text-sm text-left hover-elevate active-elevate-2"
              data-testid={`sheet-flag-${m.id}`}
            >
              <Star className={cn("h-4 w-4", m.flaggedByMe ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
              {m.flaggedByMe ? "Remove star" : "Star message"}
            </button>
            {isAdmin && isMe && onEdit && !isEditing && (
              <button
                type="button"
                onClick={() => {
                  setActionSheetOpen(false);
                  startEdit();
                }}
                className="flex items-center gap-3 px-4 py-3.5 text-sm text-left hover-elevate active-elevate-2"
                data-testid={`sheet-edit-${m.id}`}
              >
                <Pencil className="h-4 w-4 text-muted-foreground" />
                Edit message
              </button>
            )}
            {isAdmin && onCreateTodo && (
              <button
                type="button"
                onClick={() => {
                  setActionSheetOpen(false);
                  onCreateTodo(m.id);
                }}
                className="flex items-center gap-3 px-4 py-3.5 text-sm text-left hover-elevate active-elevate-2"
                data-testid={`sheet-create-todo-${m.id}`}
              >
                <ListTodo className="h-4 w-4 text-muted-foreground" />
                Create to-do for another admin
              </button>
            )}
            {isAdmin && onDelete && (
              <button
                type="button"
                onClick={() => {
                  setActionSheetOpen(false);
                  onDelete(m.id);
                }}
                className="flex items-center gap-3 px-4 py-3.5 text-sm text-left text-destructive hover-elevate active-elevate-2"
                data-testid={`sheet-delete-${m.id}`}
              >
                <Trash2 className="h-4 w-4" />
                Delete message
              </button>
            )}
          </div>
          <DrawerFooter className="pt-2">
            <DrawerClose asChild>
              <Button type="button" variant="outline" data-testid={`button-close-sheet-${m.id}`}>Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

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
