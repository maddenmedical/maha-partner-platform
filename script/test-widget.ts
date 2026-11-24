// Synthetic users and local SQLite only. Never deliver notifications or email.
import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import express from "express";
import bcrypt from "bcryptjs";
import {createServer} from "node:http";
import {resolve} from "node:path";
process.env.SQLITE_DB_PATH=":memory:";process.env.NODE_ENV="test";
const localFetch=fetch;globalThis.fetch=(async(url,opts)=>{
  if(!String(url).startsWith("http://127.0.0.1:"))throw Error("external traffic disabled");return localFetch(url,opts);
}) as typeof fetch;
const {db,sqliteDb}=await import("../server/storage"),s=await import("../shared/schema");
const {registerRoutes}=await import("../server/routes"),{CURRENT_LEGAL_VERSION}=await import("../shared/legalVersion");
const now=Date.now();for(const [id,name,role] of [[1,"Admin A","admin"],[2,"Admin B","admin"],[3,"Elias Linden","partner"]] as const){
  db.insert(s.users).values({id,name,role,status:"approved",email:`${id}@example.invalid`,passwordHash:bcrypt.hashSync("synthetic-widget-only",4),createdAt:now,legalAcceptedVersion:CURRENT_LEGAL_VERSION,installBannerDismissedAt:now,pushNudgeLastPromptedAt:now}).run();
  db.insert(s.sessions).values({token:`widgetqa-${id}`,userId:id,expiresAt:now+86400000}).run();
}
const t=db.insert(s.chatThreads).values({userId:3,userRole:"partner",createdAt:now-20000,topic:"Private general topic"}).returning().get();
db.insert(s.chatMessages).values({threadId:t.id,senderId:3,senderRole:"partner",senderName:"Fixture",body:"private fixture",createdAt:now-3000}).run();
// Legacy shared baseline and admin-only chatter must not inflate snapshot.
const old=db.insert(s.chatThreads).values({userId:3,userRole:"partner",createdAt:now-20000,adminLastReadAt:now-300,topic:"History"}).returning().get();
db.insert(s.chatMessages).values({threadId:old.id,senderId:3,senderName:"Fixture",senderRole:"partner",body:"old",createdAt:now-5000}).run();
const g=randomUUID();
db.insert(s.guestChatInvites).values({id:g,createdBy:1,tokenHash:randomUUID(),label:"Mira Adler",topic:"Private",createdAt:now-5000,openedAt:now-4000,expiresAt:now+5000}).run();
db.insert(s.guestChatMessages).values({inviteId:g,requestId:randomUUID(),senderRole:"guest",senderName:"Guest",body:"private fixture",createdAt:now-1000}).run();
// Newer outgoing reply cannot change "latest unread" age.
db.insert(s.guestChatMessages).values({inviteId:g,requestId:randomUUID(),senderRole:"admin",senderId:2,senderName:"B",body:"response",createdAt:now}).run();
const app=express();app.use(express.json());const server=createServer(app);await registerRoutes(server,app);
app.use(express.static(resolve("dist/public")));app.get("/{*path}",(_,r)=>r.sendFile(resolve("dist/public/index.html")));
await new Promise<void>(r=>server.listen(process.argv.includes("--serve")?5364:0,"127.0.0.1",r));
if(process.argv.includes("--serve")){console.log("Synthetic widget UI fixture on 5364");}else{
const base=`http://127.0.0.1:${(server.address() as any).port}`;
const call=(path:string,opts:{user?:number;token?:string;body?:object;origin?:string;post?:boolean;headers?:Record<string,string>}={})=>fetch(base+path,{method:opts.body||opts.post?"POST":"GET",
  headers:{...(opts.user?{cookie:`sid=widgetqa-${opts.user}`}:{}) ,...(opts.token?{authorization:`Bearer ${opts.token}`}:{}) ,
    ...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.origin?{origin:opts.origin}:{}),...opts.headers},body:opts.body?JSON.stringify(opts.body):undefined});
const token=randomBytes(32).toString("hex"),id=createHash("sha256").update(token).digest("hex"),a="/api/admin/widget/",snapshot="/api/widget/snapshot";
const expect=async(path:string,o:Parameters<typeof call>[1],status:number)=>{const r=await call(path,o);assert.equal(r.status,status,path);return r;};
try{
  await expect(snapshot,{user:1},401);await expect(snapshot,{token},401);await expect("/api/widget/start",{post:true},401);
  assert.deepEqual(await(await expect("/api/widget/start",{token,post:true,headers:{"x-maha-names-id":"a".repeat(64)}},200)).json(),{id,expiresIn:300});
  await expect(a+"approve",{body:{id}},401);await expect(a+"approve",{user:3,body:{id}},403);
  await expect(a+"approve",{user:1,body:{id},origin:"https://elsewhere.invalid"},403);
  await expect(a+"approve",{user:1,body:{id},origin:base},200);await expect(a+"approve",{user:2,body:{id}},410);
  await expect(snapshot,{token:id},401);await expect(a+"devices",{token},401);
  await expect("/api/admin/chat/threads",{token},401);await expect(a+"open/"+id,{user:2},404);
  const get=async()=>{const r=await expect(snapshot,{token},200);assert.match(r.headers.get("cache-control")||"",/no-store/);const data=await r.json();assert.deepEqual(Object.keys(data).sort(),["checkedAt","count","latestAt"]);return data;};
  assert.deepEqual([(await get()).count,(await get()).latestAt],[2,now-1000]);
  const secondary=randomBytes(32).toString("hex"),scope=createHash("sha256").update(secondary).digest("hex");
  const named={token,headers:{"x-maha-names-key":secondary}},people="/api/widget/people";
  await expect(people,named,403);await expect("/api/widget/name-request",{token,post:true,headers:{"x-maha-names-id":scope}},200);
  await expect(a+"allow-names",{user:2,body:{namesId:scope,showNames:true}},404);
  await expect(a+"allow-names",{user:1,body:{namesId:scope,showNames:false}},404);
  await expect(a+"allow-names",{user:1,body:{namesId:scope,showNames:true}},200);
  await expect(people,{token},403);await expect(people,{token,headers:{"x-maha-names-key":token}},403);
  let list=(await(await expect(people,named,200)).json()).people;assert.deepEqual(list.map((r:any)=>r.label),["Mira Adler","Elias Linden"]);
  assert.deepEqual(Object.keys(list[0]).sort(),["at","label","ref"]);await get();
  const exact=a+"row/"+id+"/"+list[1].ref;await expect(exact,{user:2},404);
  assert.equal((await(await expect(exact,{user:1},200)).json()).path,`/admin/chat/thread/${t.id}`);
  const tmp:string[]=[];for(const [i,label] of Array.from(["Anja Vale","Nora Vale","Luca Reed","Theo Reed"].entries())){
    const k=randomUUID();tmp.push(k);db.insert(s.guestChatInvites).values({id:k,createdBy:1,tokenHash:randomUUID(),label,topic:"Never disclose",createdAt:now-4000,openedAt:now-3000,expiresAt:now+5000}).run();
    for(const skew of [10,20])db.insert(s.guestChatMessages).values({inviteId:k,requestId:randomUUID(),senderRole:"guest",senderName:"Not a trusted contact",body:"Never disclose",createdAt:now+skew+i}).run();
  }
  const many=await(await expect(people,named,200)).json();assert.equal(many.count,6);assert.equal(many.people.length,3);assert.deepEqual(many.people.map((r:any)=>r.label),["Theo Reed","Luca Reed","Nora Vale"]);
  assert.equal((await(await expect(exact,{user:1},200)).json()).path,`/admin/chat/thread/${t.id}`);
  for(const k of tmp)sqliteDb.prepare("UPDATE guest_chat_invites SET revoked_at=? WHERE id=?").run(now,k);
  sqliteDb.prepare("UPDATE guest_chat_invites SET label=? WHERE id=?").run("person@example.invalid",g);
  sqliteDb.prepare("UPDATE users SET name=? WHERE id=3").run("+44 999 8888");
  list=(await(await expect(people,named,200)).json()).people;assert.deepEqual(list.map((r:any)=>r.label),["Invited guest","MAHA member"]);
  assert.equal((await(await expect(a+"open/"+id,{user:1},200)).json()).path,`/admin/chat/invitation/${g}`);
  await expect(`/api/admin/guest-chats/${g}`,{user:2},200);assert.equal((await get()).count,2);
  await expect(`/api/admin/guest-chats/${g}`,{user:1},200);assert.equal((await get()).count,1);assert.equal((await get()).latestAt,now-3000);
  assert.equal((await(await expect(a+"open/"+id,{user:1},200)).json()).path,`/admin/chat/thread/${t.id}`);
  await expect(`/api/admin/chat/threads/${t.id}/messages`,{user:1},200);assert.equal((await get()).count,0);assert.equal((await get()).latestAt,null);
  await expect(exact,{user:1},410);await expect("/api/widget/hide",{token,post:true},200);await expect(people,named,403);await expect(exact,{user:1},404);
  assert.equal((await(await expect(a+"open/"+id,{user:1},200)).json()).path,"/admin/chat");
  sqliteDb.prepare("UPDATE users SET archived_at=? WHERE id=1").run(now);await expect(snapshot,{token},401);sqliteDb.prepare("UPDATE users SET archived_at=NULL WHERE id=1").run();
  await expect(a+"revoke",{user:2,body:{id}},404);await expect(a+"revoke",{user:1,body:{id}},200);
  await expect(snapshot,{token},401);await expect(a+"open/"+id,{user:1},404);await expect("/api/widget/start",{token,post:true},409);
  console.log("PASS pairing/no-secret public id, authenticated explicit approval, wrong role/account/origin, snapshot-only credential, no sensitive fields, canonical two-admin unread counts/latest, exact tap + zero, deactivation/revocation");
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
