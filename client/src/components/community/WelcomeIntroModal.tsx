import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Video, X } from "lucide-react";

interface WelcomeIntroModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPosted: () => void;
}

// "Fully skippable... Posted AS the new member themselves. Video via file
// upload (not in-browser recording)." -- a plain <input type="file"
// accept="video/*"> is deliberate here, not a stand-in for a recorder.
export function WelcomeIntroModal({ open, onOpenChange, onPosted }: WelcomeIntroModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState(() => (user?.name ? `👋 Hi everyone, I'm ${user.name}!` : "👋 Hi everyone!"));

  const postMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Please choose a video to upload");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("body", caption.trim());
      const res = await apiRequest("POST", "/api/community/welcome-intro", formData, true);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Welcome video posted", description: "Your introduction is now live in the Community." });
      setFile(null);
      onOpenChange(false);
      onPosted();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't post your intro", description: err.message, variant: "destructive" });
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    if (!picked.type.startsWith("video/")) {
      toast({ title: "Please choose a video file", variant: "destructive" });
      e.target.value = "";
      return;
    }
    setFile(picked);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !postMutation.isPending && onOpenChange(next)}>
      <DialogContent data-testid="dialog-welcome-intro">
        <DialogHeader>
          <DialogTitle>Introduce yourself</DialogTitle>
          <DialogDescription>
            Upload a short welcome video for the MAHA community. This posts under your own name in the Introductions
            topic — you can do this any time, or skip it entirely.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium mb-1.5 block" htmlFor="welcome-intro-caption">
              Caption
            </label>
            <Textarea
              id="welcome-intro-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              data-testid="textarea-welcome-intro-caption"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Video</label>
            {file ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-card p-2.5">
                <span className="flex items-center gap-2 text-sm truncate min-w-0">
                  <Video className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate">{file.name}</span>
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover-elevate active-elevate-2 rounded-full p-1 shrink-0"
                  onClick={() => {
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  aria-label="Remove video"
                  data-testid="button-welcome-intro-remove-file"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-lg border border-dashed border-card-border p-4 text-sm text-muted-foreground hover-elevate active-elevate-2 flex flex-col items-center gap-1.5"
                data-testid="button-welcome-intro-choose-file"
              >
                <Video className="h-5 w-5" />
                Choose a video from your device
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={handleFileChange}
              data-testid="input-welcome-intro-file"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={postMutation.isPending} data-testid="button-welcome-intro-skip">
            Maybe later
          </Button>
          <Button
            onClick={() => postMutation.mutate()}
            disabled={!file || postMutation.isPending}
            data-testid="button-welcome-intro-submit"
          >
            {postMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Post introduction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
