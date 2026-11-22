import {Link,Redirect} from "wouter";
import {Button} from "@/components/ui/button";
import {recentGuests} from "@/lib/guestDevice";
import {EnterGuestCode} from "./EnterGuestCode";
import Login from "@/pages/auth/Login";
export function GuestLaunch(){
  const chats=recentGuests();
  if(chats.length===1)return <Redirect to={`/guest-chat/${chats[0].id}`}/>;
  if(!chats.length)return <Login/>;
  return <main className="max-w-md mx-auto p-6 space-y-3"><h1 className="text-xl font-semibold">Choose your saved guest chat</h1>
    {chats.map((c,i)=><Button asChild variant="outline" className="w-full" key={c.id}><Link href={`/guest-chat/${c.id}`}>Chat {i+1} · Last opened {new Date(c.at).toLocaleString()}</Link></Button>)}
    <EnterGuestCode/><Link href="/login" className="underline text-sm">Use a partner account instead</Link></main>;
}
