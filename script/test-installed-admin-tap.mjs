// Run in a dedicated dbus-run-session / Xvfb, against the isolated notification fixture.
import assert from "node:assert/strict";
import {execFileSync,spawn} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {chromium} from "playwright";
const base="http://127.0.0.1:5067", profile=mkdtempSync(join(tmpdir(),"maha-tap-fixture-"));
const desk=spawn("/usr/bin/python3",["script/fixture-notification-desktop.py"],{stdio:"inherit"});
const api=async(path,who="qa-1",body)=>{const r=await fetch(base+path,{method:body?"POST":"GET",headers:{cookie:`sid=${who}`,"Content-Type":"application/json"},body:body&&JSON.stringify(body)});assert.ok(r.ok,`fixture ${path}: ${r.status}`);return r.json();};
const wait=async fn=>{for(let i=0;i<80;i++){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,150));}throw Error("Timed out waiting for fixture action");};
let ctx;
try{
 const thread=await api("/api/admin/staff-chat/dm/threads","qa-2",{otherAdminId:1});await api(`/api/admin/staff-chat/dm/threads/${thread.id}/messages`,"qa-2",{body:"Fixture only"});
 const n=(await api("/api/notifications")).items.find(i=>i.category==="staff"&&i.url.endsWith(`/dm/${thread.id}`));assert.ok(n);
 for(const who of ["qa-2","qa-3"])assert.ok([403,404].includes((await fetch(base+"/api/admin/notification-target/"+n.id,{headers:{cookie:"sid="+who}})).status));
 assert.equal((await api("/api/admin/notification-target/"+n.id)).path,`/admin/chat/dm/${thread.id}`);
 console.log("PASS real resolver checks notice ownership, role and correct DM");
 ctx=await chromium.launchPersistentContext(profile,{headless:false,executablePath:process.env.CHROME_PATH||"/opt/pplx-chromium/chrome",args:["--no-sandbox","--enable-features=NativeNotifications","--no-first-run"],ignoreDefaultArgs:["--disable-background-networking"],viewport:{width:390,height:844}});
 await ctx.addCookies([{name:"sid",value:"qa-1",url:base}]);await ctx.grantPermissions(["notifications"],{origin:base});
 const p=await ctx.newPage(),cdp=await ctx.newCDPSession(p);let reg;
 cdp.on("ServiceWorker.workerRegistrationUpdated",e=>{reg=e.registrations.find(r=>r.scopeURL.startsWith(base))?.registrationId||reg;});
 await cdp.send("ServiceWorker.enable");await p.goto(base+"/admin/#/admin/home");await p.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));await wait(()=>reg);
 if(process.env.MAHA_TEST_INSTALLED){
   await cdp.send("PWA.install",{manifestId:base+"/admin/",installUrlOrBundleUrl:base+"/admin/"});
   const os=await cdp.send("PWA.getOsAppState",{manifestId:base+"/admin/"});
   assert.ok(Array.isArray(os.fileHandlers));console.log("PASS Chromium installed MAHA Admin using its actual manifest and OS app identity");
 }
 const worker=await wait(()=>ctx.serviceWorkers()[0]);
 const read=()=>worker.evaluate(async()=>{const n=(await self.registration.getNotifications()).at(-1);return n&&{title:n.title,native:n.navigate||null,tag:n.tag};});
 const notify=async (name)=>{await cdp.send("ServiceWorker.deliverPushMessage",{origin:base,registrationId:reg,data:JSON.stringify({title:name,body:"Fixture only",url:n.url,tag:n.id,badgeCount:1})});return wait(async()=>{const v=await read();return v?.title===name?v:false;});};
 const click=async title=>wait(()=>{try{return execFileSync("/usr/bin/python3",["script/fixture-notification-desktop.py",title],{encoding:"utf8"}).trim()==="clicked";}catch{return false;}});
 for(const mode of ["warm","cold"]){
   const title=`Fixture MAHA ${mode}`;const notice=await notify(title);
   if(mode==="cold")for(const win of ctx.pages())if(win.url().startsWith(base))await win.close();
   await click(title);
   const landed=await wait(()=>ctx.pages().find(win=>win.url().endsWith(`#/admin/chat/dm/${thread.id}`)));
   await landed.getByTestId("alert-conversation").locator("textarea").first().waitFor();
   console.log(`PASS actual Chromium desktop notification default action (${mode}) -> authorized DM and composer; native navigate exposed=${!!notice.native}`);
   if(mode==="warm")await landed.goto(base+"/admin/#/admin/home");
 }
 const resumed=await ctx.newPage();await resumed.addInitScript(()=>Object.defineProperty(navigator,"standalone",{value:true}));await resumed.goto(base+"/admin/");
 const w=await wait(()=>ctx.serviceWorkers()[0]);await w.evaluate(()=>{Object.defineProperty(self.clients,"openWindow",{configurable:true,value:async()=>{throw Error("simulated platform rejection");}});Object.defineProperty(self.clients,"matchAll",{configurable:true,value:async()=>[]});});
 const c2=await ctx.newCDPSession(resumed);let reg2;c2.on("ServiceWorker.workerRegistrationUpdated",e=>{reg2=e.registrations.find(r=>r.scopeURL.startsWith(base))?.registrationId||reg2;});await c2.send("ServiceWorker.enable");await wait(()=>reg2);
 const failureStart=Date.now();await c2.send("ServiceWorker.deliverPushMessage",{origin:base,registrationId:reg2,data:JSON.stringify({title:"Fixture platform failure",url:n.url,tag:n.id})});
 await click("Fixture platform failure");
 await wait(()=>resumed.evaluate(async ({id,start})=>(await(await caches.open("maha-admin-tap-v1")).keys()).some(k=>new URL(k.url).pathname.endsWith("/"+id)&&k.url.includes("/.tap/")&&Number(new URL(k.url).pathname.split("/").at(-2))>=start),{id:n.id,start:failureStart}));
 await resumed.reload();await resumed.waitForURL(`**/#/admin/chat/dm/${thread.id}`);await resumed.getByTestId("alert-conversation").locator("textarea").first().waitFor();
 console.log("PASS real desktop click with injected platform openWindow failure survives into next Home launch");
 // Real CacheStorage rescue, using only synthetic IDs. Delivery alone must
 // never redirect a manually opened app, and a handled click may not replay.
 const r=await ctx.newPage();await r.addInitScript(()=>Object.defineProperty(navigator,"standalone",{value:true}));await r.goto(base+"/admin/#/admin/home");
 await r.evaluate(async id=>{const c=await caches.open("maha-admin-tap-v1");await c.put(`/admin/.tap/${Date.now()}/${id}`,new Response("1"));},n.id);
 await r.reload();await r.waitForURL(`**/#/admin/chat/dm/${thread.id}`);await r.getByTestId("alert-conversation").locator("textarea").first().waitFor();
 await r.goto(base+"/admin/");await r.waitForURL("**/#/admin/home");assert.ok(!r.url().includes("/open-alert/"));
 console.log("PASS standalone launch recovers specific saved tap, then normal Home launch does not replay it");
 await ctx.clearCookies();await r.goto(base+"/admin/open-alert/"+n.id);await r.locator("#email").waitFor();
 // Use fixture cookie to model successful credential verification, never a real user.
 await r.route("**/api/auth/login",async route=>{await ctx.addCookies([{name:"sid",value:"qa-1",url:base}]);await route.fulfill({json:{user:await api("/api/auth/me")}});});
 await r.locator("#email").fill("test@example.invalid");await r.locator("#password").fill("fixture");
 await r.getByTestId("button-submit-login").click();await r.waitForURL(`**/#/admin/chat/dm/${thread.id}`);await r.getByTestId("alert-conversation").locator("textarea").first().waitFor();
 console.log("PASS signed-out physical launch URL resumes the same private DM after fixture sign-in");
}finally{await ctx?.close();desk.kill();rmSync(profile,{force:true,recursive:true});}
