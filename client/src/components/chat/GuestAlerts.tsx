import {useState} from "react";
import {Button} from "@/components/ui/button";
import {isPushSupported,iosNeedsInstall,subscribeToPush} from "@/lib/push";
import {apiRequest,queryClient} from "@/lib/queryClient";
export function GuestAlerts({endpoint,enabled}:{endpoint:string;enabled:boolean}){
  const [status,setStatus]=useState(""),[working,setWorking]=useState(false);
  async function toggle(){
    setWorking(true);setStatus("");
    try{
      if(enabled){await apiRequest("POST",`${endpoint}/notifications/disable`,{});setStatus("Reply notifications are off.");}
      else if(iosNeedsInstall()){setStatus("Add MAHA to your iPhone Home Screen, open it there, then return to this chat and tap Notify me.");}
      else if(!isPushSupported()){setStatus("This browser cannot receive phone notifications. Open MAHA in a supported browser or the installed app, and move this chat there if needed.");}
      else if(Notification.permission==="denied"){setStatus("Notifications are blocked. In your phone or browser settings, allow notifications for MAHA, then return here and tap Notify me.");}
      else{await subscribeToPush(`${endpoint}/notifications/enable`);setStatus("Reply notifications are on for this device.");}
      await queryClient.invalidateQueries({queryKey:[endpoint]});
    }catch(e){setStatus(e instanceof Error?`${e.message} You can keep chatting and try again here.`:"Could not enable notifications. Try again here.");}finally{setWorking(false);}
  }
  return <div className="space-y-1"><Button size="sm" variant="outline" disabled={working} onClick={toggle}>{enabled?"Turn off guest reply notifications":"Notify me when MAHA replies"}</Button>{status&&<p role="status" className="text-xs">{status}</p>}</div>;
}
