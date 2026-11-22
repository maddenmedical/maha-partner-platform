import {useEffect,type ReactNode} from "react";
import {MoreHorizontal} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Popover,PopoverContent,PopoverTrigger} from "@/components/ui/popover";

// iOS Safari's keyboard resizes the visual viewport, not always the layout
// viewport. Scope these measurements to conversation surfaces, never the shell.
export function useChatViewport(active:boolean){
  useEffect(()=>{
    if(!active)return;
    const v=window.visualViewport;
    const root=document.documentElement;
    function update(){root.style.setProperty("--chat-vh",`${v?.height??innerHeight}px`);root.style.setProperty("--chat-top",`${v?.offsetTop??0}px`);}
    update();v?.addEventListener("resize",update);v?.addEventListener("scroll",update);window.addEventListener("resize",update);
    return()=>{v?.removeEventListener("resize",update);v?.removeEventListener("scroll",update);window.removeEventListener("resize",update);};
  },[active]);
}
export function ChatTools({children,label="Chat details",open,onOpenChange}:{children:ReactNode;label?:string;open?:boolean;onOpenChange?:(v:boolean)=>void}){
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild><Button aria-label={label} title={label} size="icon" variant="ghost" className="shrink-0 rounded-full"><MoreHorizontal className="size-5"/></Button></PopoverTrigger>
    <PopoverContent aria-label={label} align="end" side="bottom" collisionPadding={8} className="chat-tools space-y-3">
      <h3 className="text-sm font-semibold">{label}</h3>{children}
    </PopoverContent>
  </Popover>;
}
export function AttachmentNote(){return <p className="text-xs text-muted-foreground leading-relaxed">Photos, documents, video and voice notes · up to 20 MB per file. Please avoid identifiable patient information before verification.</p>;}
