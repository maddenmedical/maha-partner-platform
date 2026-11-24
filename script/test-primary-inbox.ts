// Real routes, UI and in-memory SQLite. Only fictional data; block external traffic.
import assert from "node:assert/strict";
import express from "express";
import {createServer} from "node:http";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {chromium} from "playwright";
process.env.NODE_ENV="test";process.env.SQLITE_DB_PATH=":memory:";
const fetchLocal=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  if(!String(input).startsWith("http://127.0.0.1:"))throw Error("External delivery disabled");
  return fetchLocal(input,init);
};
const {db}=await import("../server/storage");
const s=await import("../shared/schema");
const {CURRENT_LEGAL_VERSION}=await import("../shared/legalVersion");
const {registerRoutes}=await import("../server/routes");
const now=Date.now();
for(const [id,name,role] of [[1,"Morgan Vale","admin"],[2,"Alex Rowan","admin"],[3,"Elias Linden","partner"]] as const){
  db.insert(s.users).values({id,name,role,email:`person${id}@example.invalid`,status:"approved",passwordHash:"fixture",createdAt:now,legalAcceptedVersion:CURRENT_LEGAL_VERSION,installBannerDismissedAt:now,pushNudgeLastPromptedAt:now}).run();
  db.insert(s.sessions).values({token:`fixture-${id}`,userId:id,expiresAt:now+86400000}).run();
}
function invite(label:string,extra:Partial<typeof s.guestChatInvites.$inferInsert>={}){
  const id=randomUUID();
  db.insert(s.guestChatInvites).values({id,createdBy:1,tokenHash:randomUUID(),label,topic:"Private fixture topic",createdAt:now-6000,expiresAt:now+86400000,...extra}).run();return id;
}
function reply(id:string,at:number){db.insert(s.guestChatMessages).values({inviteId:id,requestId:randomUUID(),senderName:"Guest",senderRole:"guest",body:"Private fixture content",createdAt:at}).run();}
const guest=invite("Mira Adler",{openedAt:now-4500}),older=invite("Nora Linden",{openedAt:now-5000});
reply(guest,now-500); invite("Unopened");invite("Declined",{openedAt:now,declinedAt:now});invite("Revoked",{openedAt:now,revokedAt:now});
const app=express();app.use(express.json());const server=createServer(app);await registerRoutes(server,app);
app.use(express.static(path.resolve("dist/public")));app.get("/{*path}",(_,res)=>res.sendFile(path.resolve("dist/public/index.html")));
await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${(server.address() as any).port}`;
const api=(p:string,n=1,body?:object)=>fetch(base+p,{method:body?"POST":"GET",headers:{cookie:`sid=fixture-${n}`,"Content-Type":"application/json"},body:body&&JSON.stringify(body)});
const json=async(p:string,n=1,body?:object)=>{const r=await api(p,n,body);assert.equal(r.status,200,p);return r.json();};
const list="/api/admin/chat/inbox-invitations",members="/api/admin/chat/threads",detail=`/api/admin/guest-chats/${guest}`;
const unread=async(id:string,n:number)=>(await json(list,n)).find((i:any)=>i.id===id)?.unread;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:["--no-sandbox"]});
try{
  const rows=await json(list);assert.deepEqual(rows.map((r:any)=>r.id),[guest,older]);assert.deepEqual(Object.keys(rows[0]).sort(),["id","label","lastMessageAt","unread"]);
  assert.equal((await api(list,99)).status,401);assert.equal((await api(list,3)).status,403);
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"block"});
  await ctx.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await ctx.addCookies([{name:"sid",value:"fixture-1",url:base}]);
  const page=await ctx.newPage();page.setDefaultTimeout(12000);
  const row=page.getByTestId(`inbox-invitation-${guest}`), other=page.getByTestId(`inbox-invitation-${older}`);
  await page.goto(base+"/admin/#/admin/chat");await row.waitFor();assert.equal(await page.getByText("No active chats").count(),0);
  console.log("PASS guest-only Active, exclusions, admin role, metadata-only response");
  const t=db.insert(s.chatThreads).values({userId:3,userRole:"partner",topic:"General enquiry",createdAt:now-4500}).returning().get();
  db.insert(s.chatMessages).values({threadId:t.id,senderId:3,senderRole:"partner",senderName:"Elias Linden",body:"Thank you for the information.",createdAt:now-1500}).run();
  const member=page.getByTestId(`button-thread-${t.id}`);await member.waitFor();
  const y=async(el:typeof row)=>(await el.boundingBox())!.y;
  assert.ok(await y(row)<await y(member)&&await y(member)<await y(other));
  assert.equal(await page.getByText(/Private fixture/).count(),0);assert.equal(await row.getByText("Unread").count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.QA_SCREENSHOT)await page.screenshot({path:process.env.QA_SCREENSHOT});
  reply(older,now+10);await other.getByText("Unread").waitFor();assert.ok(await y(other)<await y(row));
  console.log("PASS mixed mobile ordering, no guest preview, new incoming moves to top during open list");
  await row.click();await page.getByRole("heading",{name:"Mira Adler"}).waitFor();const composer=page.locator("textarea").first();await composer.fill("Synthetic local reply");await composer.press("Enter");await page.getByRole("log").getByText("Synthetic local reply").waitFor();
  assert.ok(page.url().endsWith(`/invitation/${guest}`));assert.equal(await unread(guest,1),false);assert.equal(await unread(guest,2),true);
  await page.getByText("Back to Chat Inbox").click();await row.waitFor();await row.getByText("Unread").waitFor({state:"hidden"});
  reply(guest,now+100);await row.getByText("Unread").waitFor();assert.ok(await y(row)<await y(other));
  console.log("PASS one tap exact composer, synthetic reply in same thread, personal unread and later reply");
  await json(`${members}/${t.id}/messages`);const marker=async(id:number,n:number)=>(await json(members,n)).find((r:any)=>r.id===id).unread;
  assert.equal(await marker(t.id,1),false);assert.equal(await marker(t.id,2),true);
  await json(detail);const {threadId}=await json(detail+"/link",1,{userId:3});
  assert.equal(await unread(guest,2),undefined);assert.equal(await marker(threadId,1),false);assert.equal(await marker(threadId,2),true);
  assert.equal((await json(members)).filter((r:any)=>r.sourceInvitationId===guest).length,1);
  assert.equal((await json("/api/admin/dashboard-summary",2)).unreadChatThreads,3);
  await page.goto(base+`/admin/#/admin/chat/invitation/${guest}`);await page.waitForURL(`**/#/admin/chat/thread/${threadId}`);
  console.log("PASS member read isolation, linked transfer dedup and personal cursors, Home count, old alert redirects");
}finally{await browser.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
