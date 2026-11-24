// Synthetic identities only. Real message writers, invitation linking, SQLite and client.
import assert from "node:assert/strict";
import express from "express";
import {createServer} from "node:http";
import path from "node:path";
import {chromium,type Page} from "playwright";
process.env.NODE_ENV="test";process.env.SQLITE_DB_PATH=":memory:";
const local=globalThis.fetch;
globalThis.fetch=(input,init)=>{if(!String(input).startsWith("http://127.0.0.1:"))throw Error("No external traffic");return local(input,init);};
const {db}=await import("../server/storage"),s=await import("../shared/schema");
const {CURRENT_LEGAL_VERSION}=await import("../shared/legalVersion"),{registerRoutes}=await import("../server/routes");
const now=Date.now(),names=["","Dr. Mara Vale","Alex Rowan","Noah Linden"];
for(const id of [1,2,3]){
 db.insert(s.users).values({id,name:names[id],role:id===3?"partner":"admin",status:"approved",email:`author${id}@example.invalid`,passwordHash:"fixture",createdAt:now,legalAcceptedVersion:CURRENT_LEGAL_VERSION,installBannerDismissedAt:now,pushNudgeLastPromptedAt:now}).run();
 db.insert(s.sessions).values({token:`author-${id}`,userId:id,expiresAt:now+86400000}).run();
}
const app=express();app.use(express.json());const server=createServer(app);await registerRoutes(server,app);
app.use(express.static(path.resolve("dist/public")));app.get("/{*path}",(_,res)=>res.sendFile(path.resolve("dist/public/index.html")));
await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
async function api(p:string,id:number,body?:object){
 const r=await fetch(base+p,{method:body?"POST":"GET",headers:{cookie:`sid=author-${id}`,"content-type":"application/json"},body:body&&JSON.stringify(body)});
 assert.ok(r.ok,`${p}: ${r.status}`);return r.json();
}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:["--no-sandbox"]});
async function page(id:number){
 const c=await browser.newContext({viewport:{width:425,height:900},serviceWorkers:"block"});
 await c.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 if(id)await c.addCookies([{name:"sid",value:`author-${id}`,url:base}]);
 const p=await c.newPage();p.setDefaultTimeout(10000);return p;
}
async function check(p:Page,body:string,label:string,gold:boolean,own:boolean){
 const b=p.locator('[data-testid^="bubble-"]:visible').filter({hasText:body}).first();await b.waitFor();
 const id=(await b.getAttribute("data-testid"))!.slice(7);
 assert.equal(await b.getByTestId(`author-${id}`).innerText(),label);
 assert.equal(await p.locator(`[data-testid="message-${id}"]:visible`).evaluate(e=>e.classList.contains("self-end")),own);
 assert.equal(await b.evaluate(e=>e.classList.contains("bg-primary")),gold);
 if(!own)assert.equal(await p.getByTestId(`button-edit-message-${id}`).count(),0);
 // Compare actual computed colours against the theme's primary and check foreground contrast.
 const {actual,expected,fg}=await b.evaluate(e=>{
   const sample=document.createElement("i");sample.className="bg-primary";document.body.append(sample);
   const expected=getComputedStyle(sample).backgroundColor,style=getComputedStyle(e),actual=style.backgroundColor,fg=style.color;sample.remove();
   return {actual,expected,fg};
 });
 const lum=(v:string)=>v.match(/[\d.]+/g)!.slice(0,3).map(n=>Number(n)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);
 const l1=lum(actual),l2=lum(fg),ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
 assert.equal(actual===expected,gold);assert.ok(ratio>=4.5,`${label}: ${ratio}`);return ratio;
}
try{
 const a=await page(1),peer=await page(2),partner=await page(3),guest=await page(0);
 const target=(p:Page,kind:string)=>p.goto(`${base}/admin/#/admin/chat/${kind}`);
 const member=async(p:Page,id:number)=>{await p.goto(base+"/#/chat");const back=p.getByTestId("button-close-thread-mobile");if(await back.isVisible())await back.click();await p.getByTestId(`button-thread-${id}`).click();};
 const inv=await api("/api/admin/guest-chats",1,{label:"Fictional contact",topic:"Clinical exchange",message:"I will ask the coordinator.",intendedUserId:null});
 const detail=`/api/admin/guest-chats/${inv.id}`;
 await guest.goto(base+inv.path);await guest.getByRole("button",{name:"Start chat"}).click();
 await check(guest,"I will ask",names[1]+" · MAHA",true,false);
 async function send(p:Page,text:string){const box=p.locator("textarea").first();await box.fill(text);await box.press("Enter");await p.locator('[data-testid^="bubble-"]').filter({hasText:text}).waitFor();}
 await send(guest,"The coordinator called me.");
 await check(guest,"called me","Guest (not yet verified) (you)",false,true);
 await target(peer,`invitation/${inv.id}`);await check(peer,"I will ask",names[1]+" · MAHA",true,false);
 await api(detail+"/link-sharing",1,{enabled:true,confirmExposure:true});
 const shared=await page(0);await shared.goto(base+inv.path);
 await check(shared,"I will ask",names[1]+" · MAHA",true,false);
 await send(shared,"Shared guest response.");await check(shared,"Shared guest response.","Shared link guest (you)",false,true);
 await api(detail+"/link-sharing",1,{enabled:false,confirmExposure:true});
 const {threadId}=await api(detail+"/link",1,{userId:3});
 const adminPath=`/api/admin/chat/threads/${threadId}/messages`;
 await api(adminPath,2,{body:"I can follow up."});await api(`/api/chat/threads/${threadId}/messages`,3,{body:"I spoke with the coordinator today."});
 // Simulate incomplete historical metadata: no author ID, or role not verified.
 for(const [role,body] of [["admin","Older team note."],["unknown","Unverified old note."]])
 db.insert(s.chatMessages).values({threadId,senderId:0,senderRole:role,senderName:names[1],body,createdAt:now}).run();
 let contrast=0;
 for(const [id,p] of [[1,a],[2,peer],[3,partner]] as const){
   if(id===3)await member(p,threadId);else await target(p,`thread/${threadId}`);
   contrast=await check(p,"I will ask",names[1]+(id===1?" (you)":"")+" · MAHA",true,id===1);
   await check(p,"called me","Guest (before account verification)",false,false);
   await check(p,"Shared guest response.","Shared link guest",false,false);
   await check(p,"I can follow up",names[2]+(id===2?" (you)":"")+" · MAHA",true,id===2);
   await check(p,"I spoke with",names[3]+(id===3?" (you)":""),false,id===3);
   await check(p,"Older team note","MAHA team",true,false);
   await check(p,"Unverified old note","Unverified sender",false,false);
 }
 const t=db.insert(s.chatThreads).values({userId:3,userRole:"partner",topic:"Clinical exchange",createdAt:Date.now()}).returning().get();
 await api(`/api/admin/chat/threads/${t.id}/messages`,1,{body:"I will ask the coordinator."});
 await api(`/api/chat/threads/${t.id}/messages`,3,{body:"Thank you. I will wait for your reply."});
 for(const [id,p] of [[1,a],[2,peer],[3,partner]] as const){
   if(id===3)await member(p,t.id);else await target(p,`thread/${t.id}`);
   await check(p,"I will ask",names[1]+(id===1?" (you)":"")+" · MAHA",true,id===1);
   await check(p,"I will wait",names[3]+(id===3?" (you)":""),false,id===3);
   if(process.env.QA_DIR){
     const box=p.locator('[data-testid^="message-"]:visible').filter({hasText:"I will wait"}).first();
     await box.locator("..").screenshot({path:path.join(process.env.QA_DIR,`attribution-${id}.png`)});
   }
 }
 for(const [segment,targetPath] of [["room","room/main"],[`dm/threads/${(await api("/api/admin/staff-chat/dm/threads",1,{otherAdminId:2})).id}`,""]]){
   const route=`/api/admin/staff-chat/${segment}/messages`;await api(route,1,{body:"I will ask the coordinator."});await api(route,2,{body:"I can follow up."});
   await target(peer,targetPath||"dm/"+segment.split("/").pop());
   await check(peer,"I will ask",names[1]+" · MAHA",true,false);
   await check(peer,"I can follow up",names[2]+" (you) · MAHA",true,true);
 }
 await partner.evaluate(()=>document.documentElement.classList.add("dark"));
 const darkContrast=await check(partner,"I will ask",names[1]+" · MAHA",true,false);
 await check(partner,"I will wait",names[3]+" (you)",false,true);
 console.log(`PASS dark theme: gold ${darkContrast.toFixed(2)}:1`);
 const enabled=await fetch(base+"/api/admin/community/enabled",{method:"PATCH",headers:{cookie:"sid=author-1","content-type":"application/json"},body:JSON.stringify({enabled:true})});
 assert.ok(enabled.ok);
 const {topic}=await api("/api/community/topics",1,{title:"Clinical coordination",body:"Team post from the coordinator."});
 await api(`/api/community/topics/${topic.id}/messages`,2,{body:"Second clinician reply."});
 await api(`/api/community/topics/${topic.id}/messages`,3,{body:"I will ask our coordinator."});
 for (const [id,p] of [[1,a],[2,peer],[3,partner]] as const){
   await p.goto(base+(id===3?"/#/chat/community":"/admin/#/admin/community"));
   await p.getByTestId(`button-topic-${topic.id}`).click();
   await check(p,"Team post from",names[1]+(id===1?" (you)":"")+" · MAHA",true,id===1);
   await check(p,"Second clinician reply",names[2]+(id===2?" (you)":"")+" · MAHA",true,id===2);
   await check(p,"I will ask our",names[3]+(id===3?" (you)":""),false,id===3);
 }
 console.log("PASS Community: clinician, second admin and partner posts viewed by each reader; named amber only for MAHA, neutral partner even when own, role-independent alignment.");
 console.log(`PASS personal/shared guest, transferred personal/shared history, three readers, registered partner, staff room/DM, unknown metadata, own controls and contrast (gold ${contrast.toFixed(2)}:1)`);
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
