import { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Smile } from "lucide-react";

// A small curated set covering the common WhatsApp-style reactions plus a
// few dental/clinical-flavored extras -- not a full emoji keyboard, but
// enough for quick composing and reacting without pulling in a heavy
// third-party emoji-mart dependency.
export const QUICK_EMOJIS = [
  "👍", "❤️", "😂", "😮", "😢", "🙏",
  "🎉", "👏", "😊", "😍", "🤔", "😅",
  "🔥", "✅", "❌", "👌", "🥳", "😴",
  "💪", "🦷", "🩺", "📅", "⚠️", "💬",
  "😃", "😉", "🙌", "👀", "🚀", "📎",
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  trigger?: React.ReactNode;
  align?: "start" | "center" | "end";
  testId?: string;
}

export function EmojiPicker({ onSelect, trigger, align = "start", testId = "button-emoji-picker" }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="ghost" size="icon" className="shrink-0" data-testid={testId}>
            <Smile className="h-4 w-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-2">
        <div className="grid grid-cols-6 gap-1">
          {QUICK_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onSelect(e);
                setOpen(false);
              }}
              className="text-xl rounded-md p-1.5 hover-elevate active-elevate-2"
              data-testid={`emoji-option-${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
