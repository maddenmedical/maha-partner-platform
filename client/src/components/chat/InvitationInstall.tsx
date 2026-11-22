import {useState} from "react";
import {useInstallPrompt} from "@/hooks/use-install-prompt";
import {isAndroid,isIos} from "@/lib/push";
import {Button} from "@/components/ui/button";
export function InvitationInstall() {
  const {isInstalled,canInstallNative,isInstalling,promptInstall}=useInstallPrompt();
  const [help,show]=useState<"iphone"|"android"|"accepted"|null>(null);
  if(isInstalled)return null;
  const android=isAndroid(),ios=isIos();
  async function install(){if(canInstallNative){show((await promptInstall())?"accepted":"android");}else{show("android");}}
  return <div className="space-y-1"><div className="flex flex-wrap gap-2">
    {!ios && <Button variant={android||canInstallNative?"default":"outline"} size="sm" disabled={isInstalling} onClick={install}>{android?"Install on Android":canInstallNative?"Install MAHA":"Install on Android"}</Button>}
    {!android && !canInstallNative && <Button variant={ios?"default":"outline"} size="sm" onClick={()=>show("iphone")}>Add to iPhone</Button>}</div>
    {help && <div role="status" className="text-xs leading-relaxed">{help==="accepted"?"Installation requested. Follow your phone’s confirmation.":help==="iphone"?
      <>In Safari, tap <strong>Share → Add to Home Screen → Add</strong>. If you’re inside WhatsApp, open this <a className="underline" href="#/install/iphone" target="_blank" rel="noopener noreferrer">MAHA installation page</a> in Safari. If your chat isn’t there, move it using the code in your original chat.</> :
      <>In Chrome, tap <strong>Menu → Install app</strong> (or Add to Home screen). Inside WhatsApp, open this <a className="underline" href="#/install/android" target="_blank" rel="noopener noreferrer">MAHA installation page</a> in Chrome. If your chat isn’t there, use the code in your original chat.</>}</div>}
  </div>;
}
