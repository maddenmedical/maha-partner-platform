import {useState} from "react";
import {Download} from "lucide-react";
import {useInstallPrompt} from "@/hooks/use-install-prompt";
import {isAndroid,isIos} from "@/lib/push";
import {Button} from "@/components/ui/button";
import {Popover,PopoverTrigger,PopoverContent} from "@/components/ui/popover";
export function InvitationInstall({guest=false}:{guest?:boolean}) {
  const {isInstalled,canInstallNative,isInstalling,promptInstall}=useInstallPrompt();
  const [help,show]=useState<"choose"|"iphone"|"android"|"accepted"|null>(null);
  if(isInstalled)return null;
  const android=isAndroid(),ios=isIos();
  async function install(){if(canInstallNative){show((await promptInstall())?"accepted":"android");}else{show(ios?"iphone":android?"android":"choose");}}
  return <Popover open={!!help} onOpenChange={v=>{if(!v)show(null);}}>
    <PopoverTrigger asChild><Button className="chat-install-action" size="sm" disabled={isInstalling} onClick={()=>void install()}><Download aria-hidden="true"/>{ios?"Add to iPhone":android?"Install on Android":"Install MAHA"}</Button></PopoverTrigger>
    <PopoverContent className="chat-tools space-y-2" align="end" collisionPadding={8}>
      {help==="choose"&&<><p className="text-sm font-medium">Install MAHA on your phone</p><Button size="sm" onClick={()=>show("android")}>Install on Android</Button> <Button variant="outline" size="sm" onClick={()=>show("iphone")}>Add to iPhone</Button></>}
      {help&&help!=="choose"&&<div role="status" className="text-sm leading-relaxed">{help==="accepted"?"Installation requested. Follow your phone’s confirmation.":help==="iphone"?
        <>In Safari, tap <strong>Share → Add to Home Screen → Add</strong>. Inside WhatsApp, open this <a className="underline" href="#/install/iphone" target="_blank" rel="noopener noreferrer">MAHA installation page</a> in Safari.</> :
        <>In Chrome, tap <strong>Menu → Install app</strong> (or Add to Home screen). Inside WhatsApp, open this <a className="underline" href="#/install/android" target="_blank" rel="noopener noreferrer">MAHA installation page</a> in Chrome.</>}
        {guest&&help!=="accepted"&&" If your chat isn’t there, choose Move chat in your original chat options."}</div>}
      <Button variant="ghost" size="sm" onClick={()=>show(null)}>Done</Button>
    </PopoverContent>
  </Popover>;
}
