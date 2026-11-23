import {useEffect,useState} from "react";
import {useAuth} from "@/context/AuthContext";
import {handled} from "@/lib/adminAlertLaunch";
import {adminChatDestination} from "@shared/adminChatTarget";
import {Button} from "@/components/ui/button";
export function AdminAlertLaunch({id}:{id:string}){
  const {user}=useAuth(),[retry,setRetry]=useState(0),[error,setError]=useState("");
  const [openedAt]=useState(()=>Date.now());
  useEffect(()=>{
    let live=true;
    async function open(){
      if(user?.role!=="admin"||user.impersonating){await handled(id,openedAt);if(live)setError("This alert is for a different account.");return;}
      try{
        const res=await fetch(`/api/admin/notification-target/${id}`,{cache:"no-store",credentials:"same-origin",redirect:"error"});
        if(!res.ok){if(res.status===403||res.status===404){await handled(id,openedAt);if(live)setError("This alert is unavailable for this account.");return;}throw Error();}
        const {path}=await res.json();
        if(typeof path!=="string"||adminChatDestination(new URL(`/admin/#${path}`,location.origin))!==path)throw Error();
        if(!live)return;
        await handled(id,openedAt);
        if(live)location.replace(`/admin/#${path}`);
      }catch{if(live)setError("Could not open this chat. Check your connection and try again.");}
    }
    setError("");void open();return()=>{live=false;};
  },[id,user?.id,user?.role,retry,openedAt]);
  return <main className="p-5 space-y-3"><p role="status">{error||"Opening your chat…"}</p>
    {error&&<><Button onClick={()=>setRetry(n=>n+1)}>Try again</Button> <Button variant="outline" onClick={async()=>{await handled(id,openedAt);location.replace("/admin/");}}>Back to MAHA</Button></>}</main>;
}
