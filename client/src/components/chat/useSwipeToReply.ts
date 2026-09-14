import { useRef, useState } from "react";

// Shared swipe-to-reply gesture for message bubbles (1:1 chat + Community).
// Touch/pen only -- desktop has no natural "swipe" affordance, so mouse
// pointers fall through untouched and rely on the explicit Reply button
// that callers render alongside this hook's `bubbleStyle`.
//
// Mirrors the WhatsApp/Telegram pattern: drag a bubble horizontally, a
// reply arrow fades in on the side being revealed, and releasing past the
// trigger distance fires `onReply` and springs the bubble back to rest.
const SWIPE_TRIGGER_PX = 56;
const SWIPE_MAX_PX = 76;
// Movement below this in either axis is still "held still" -- keeps a
// shaky tap from being misread as a swipe. Intentionally close to (but
// independent of) ChatMessageBubble's own long-press move tolerance so
// the two gestures naturally exclude each other without extra wiring.
const SWIPE_COMMIT_PX = 12;

export function useSwipeToReply(onReply: () => void) {
  const [dragX, setDragX] = useState(0);
  const [armed, setArmed] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const modeRef = useRef<"idle" | "swipe" | "other">("idle");

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse") return;
    startRef.current = { x: e.clientX, y: e.clientY };
    modeRef.current = "idle";
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (modeRef.current === "idle") {
      if (Math.abs(dx) > SWIPE_COMMIT_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
        modeRef.current = "swipe";
      } else if (Math.abs(dy) > SWIPE_COMMIT_PX) {
        modeRef.current = "other";
      }
    }
    if (modeRef.current !== "swipe") return;
    const clamped = Math.max(-SWIPE_MAX_PX, Math.min(SWIPE_MAX_PX, dx));
    setDragX(clamped);
    setArmed(Math.abs(clamped) >= SWIPE_TRIGGER_PX);
  }

  function endSwipe(_e?: React.PointerEvent) {
    if (modeRef.current === "swipe" && armed) {
      onReply();
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(8);
        } catch {
          /* no-op */
        }
      }
    }
    startRef.current = null;
    modeRef.current = "idle";
    setDragX(0);
    setArmed(false);
  }

  return {
    dragX,
    armed,
    isSwiping: modeRef.current === "swipe",
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endSwipe,
      onPointerCancel: endSwipe,
    },
    // Applied to the bubble content itself so it visually slides with the finger.
    bubbleStyle:
      dragX !== 0
        ? { transform: `translateX(${dragX}px)`, transition: "none" as const }
        : { transition: "transform 150ms ease-out" as const },
    // Applied to the reply-arrow icon revealed on the side being dragged from.
    iconStyle: {
      opacity: Math.min(1, Math.abs(dragX) / SWIPE_TRIGGER_PX),
      ...(dragX > 0 ? { left: -28 } : { right: -28 }),
    },
    showIcon: dragX !== 0,
  };
}
