import {useState} from "react";
import {useLocation} from "wouter";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {apiRequest} from "@/lib/queryClient";
import {rememberGuest} from "@/lib/guestDevice";
export function EnterGuestCode(){
  const [code,setCode]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);const [,go]=useLocation();
  return <details className="text-sm mt-3"><summary className="cursor-pointer underline">Move my guest chat to this app</summary>
    <form className="space-y-2 mt-2" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError("");try{const r=await apiRequest("POST","/api/guest-device/move",{code});const {id}=await r.json();rememberGuest(id);setCode("");go(`/guest-chat/${id}`);}catch(e){setError(e instanceof Error?e.message:"Could not move chat.");}finally{setBusy(false);}}}>
      <p>In your original chat, choose “Move chat to the installed app”. Paste its one-time code here. This transfers only that guest chat.</p>
      <label>One-time device code<Input autoComplete="off" maxLength={40} value={code} onChange={e=>setCode(e.target.value)}/></label><Button size="sm" disabled={busy || code.replace(/[\s-]/g,"").length!==20}>Open my chat</Button>
      {error&&<p className="text-destructive" role="alert">{error}</p>}</form></details>;
}
