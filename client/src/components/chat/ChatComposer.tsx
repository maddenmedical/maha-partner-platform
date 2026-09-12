import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, API_BASE } from "@/lib/queryClient";
import { EmojiPicker } from "./EmojiPicker";
import { Send, Loader2, Paperclip, Mic, Square, X, FileText, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface PendingAttachment {
  url: string;
  name: string;
  mimeType: string;
  type: "image" | "video" | "audio" | "document";
}

interface ChatComposerProps {
  uploadUrl: string;
  threadId: number;
  onSend: (payload: { body: string; attachmentUrl?: string; attachmentType?: string; attachmentName?: string }) => Promise<unknown> | unknown;
  sending?: boolean;
  testIdPrefix?: string;
}

// Voice notes are always recorded as real audio via MediaRecorder and sent as
// a normal audio attachment the recipient can play back -- no speech-to-text,
// no transcription. Server-side transcription (Whisper) is out of scope.
export function ChatComposer({ uploadUrl, threadId, onSend, sending, testIdPrefix = "chat" }: ChatComposerProps) {
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [recording, setRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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
    });
    setBody("");
    setPendingAttachment(null);
  }

  const busy = uploading || sending || recording;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-t border-border pt-3">
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
      <div className="flex items-end gap-1">
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          onChange={(e) => handleFilePicked(e.target.files?.[0] || null)}
          data-testid={`input-${testIdPrefix}-attachment`}
        />
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
        <EmojiPicker onSelect={(e) => setBody((b) => b + e)} testId={`button-${testIdPrefix}-emoji`} />
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
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type a message..."
          rows={1}
          className="resize-none min-h-9"
          onKeyDown={(e) => {
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
