// Local in-memory fixture, no real mail, Drive, push, users or invitations.
import {chromium} from "@playwright/test";
import {once} from "node:events";
import {spawn} from "node:child_process";
import assert from "node:assert/strict";
const base="http://127.0.0.1:5105",fixture=spawn(process.execPath,["node_modules/tsx/dist/cli.mjs","script/test-events-and-invites.ts","--serve"],{env:{...process.env,QA_PORT:"5105"},detached:true,stdio:["ignore","pipe","ignore"]});
let browser;
try{
  while(!String((await once(fixture.stdout,"data"))[0]).includes("Synthetic events and chat invitations fixture")){}
  browser=await chromium.launch({executablePath:process.env.QA_CHROME_PATH,args:["--no-sandbox"]});
  const ctx=async()=>{const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"block",userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"});await c.route("**/*",r=>r.request().url().startsWith(base+"/")?r.continue():r.abort());c.setDefaultTimeout(9000);return c;};
  const admin=await ctx(),guest=await ctx();await admin.addCookies([{url:base,name:"sid",value:"feature-1"}]);
  const write=async(path,data)=>{const r=await admin.request.post(base+path,{data});assert.ok(r.ok(),`${path}: ${r.status()}`);return r.json();};
  const create=()=>write("/api/admin/guest-chats",{topic:"Workshop",label:"Synthetic guest",message:"Welcome to this synthetic workshop chat.",intendedUserId:null});
  const title="Attention: closing this chat will end your guest access.",body="Register with MAHA Portal before you close this chat. If you leave without registering, you accept losing access to this conversation.",reg="Register & keep this chat",special="Your link stays open. The warning below applies to new personal invitations.";
  const banner=async(p,shared=false)=>{await p.getByRole("heading",{name:title,exact:true}).waitFor();await p.getByText(body,{exact:true}).waitFor();assert.equal(await p.getByText(/Proposed policy|Preview only/i).count(),0);
    if(!shared)await p.getByRole("button",{name:reg,exact:true}).waitFor();assert.equal(await p.getByRole("button",{name:reg,exact:true}).count(),shared?0:1);
    assert.equal(await p.locator(".invite-access-notice").evaluate(e=>e.parentElement.firstElementChild===e),true);};
  const p=await guest.newPage(),i=await create();await p.goto(base+i.path);await banner(p);await p.getByRole("button",{name:"Start chat"}).click();await p.getByRole("log").waitFor();await banner(p);
  const field=p.getByRole("textbox",{name:"Message",exact:true});await field.fill("Question retained after closing");await p.getByTestId("button-invite-guest-send").click();await p.getByText("Question retained after closing",{exact:true}).waitFor();
  await p.getByTestId("input-invite-guest-attachment").setInputFiles({name:"test.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6TUAAAAASUVORK5CYII=","base64")});await p.getByTestId("invite-guest-pending-attachment").waitFor();await p.getByTestId("button-invite-guest-send").click();await p.waitForFunction(()=>[...document.querySelectorAll('[role=log] img')].some(e=>e.src.startsWith("blob:")&&e.naturalWidth>0));
  const tabs=[await guest.newPage(),await(await ctx()).newPage()];for(const t of tabs){await t.goto(base+i.path);await t.getByText("Your guest access has ended",{exact:true}).waitFor();assert.equal(await t.getByRole("log").count(),0);}
  assert.equal((await guest.cookies()).some(c=>c.name.startsWith("maha_guest_")),false);
  await p.setViewportSize({width:320,height:430});const g=await field.evaluate(e=>({bottom:e.getBoundingClientRect().bottom,h:visualViewport.height,w:document.documentElement.scrollWidth,ww:innerWidth,log:document.querySelector('[role=log]').getBoundingClientRect().height}));assert.ok(g.bottom<=g.h+2&&g.w<=g.ww+1&&g.log>75,JSON.stringify(g));
  await p.reload();await p.getByText("Your guest access has ended",{exact:true}).waitFor();assert.equal(await p.getByRole("log").count(),0);await p.close();
  const after=await guest.newPage();await after.goto(base+i.path);await after.getByText("Your guest access has ended",{exact:true}).waitFor();
  const direct=await create(),owned=await guest.newPage();await owned.goto(base+direct.path);await owned.getByRole("button",{name:"Start chat"}).click();await owned.getByRole("log").waitFor();await owned.close();
  const reopen=await guest.newPage();await reopen.goto(base+direct.path);await reopen.getByText("Your guest access has ended",{exact:true}).waitFor();assert.equal(await reopen.getByRole("log").count(),0);
  const register=await guest.newPage(),j=await create();await register.goto(base+j.path);await register.getByRole("button",{name:reg}).click();await register.getByLabel("Email address").fill("page-guest@example.invalid");
  await register.getByRole("button",{name:"Email me a verification code"}).click();const {code}=await(await guest.request.get(base+"/__qa/last-code")).json();await register.getByLabel("Verification code",{exact:true}).fill(code);await register.locator("#guest-first").fill("Workshop");await register.locator("#guest-last").fill("Guest");await register.getByRole("checkbox").check();await register.getByRole("button",{name:"Verify and keep my chat"}).click();await register.waitForURL(/#\/chat$/);
  await register.goto(base+j.path);await register.waitForURL(/#\/chat$/);await register.getByText("Welcome to this synthetic workshop chat.",{exact:true}).first().waitFor();assert.equal(await register.getByText(title,{exact:true}).count(),0);
  const a=`/api/admin/guest-chats/${i.id}`;await write(a+"/link-sharing",{enabled:true,confirmExposure:true});const others=await ctx(),s=await others.newPage();await s.goto(base+i.path);
  await s.getByText("Anyone with this link can read and reply. You are replying as a shared link guest.",{exact:true}).waitFor();assert.equal(await s.getByText(title,{exact:true}).count(),0);
  await write(a+"/shared-notice",{enabled:true});for(const q of [s,await(await ctx()).newPage()]){await q.goto(base+i.path);await q.reload();await q.getByText(special,{exact:true}).waitFor();await banner(q,true);await q.getByText("Question retained after closing",{exact:true}).waitFor();await q.getByRole("textbox",{name:"Message",exact:true}).fill("Draft only");}
  const fresh=await create();await write(`/api/admin/guest-chats/${fresh.id}/link`,{userId:2});assert.equal((await admin.request.post(base+`/api/admin/guest-chats/${fresh.id}/shared-notice`,{data:{enabled:true}})).status(),409);
  console.log("PASS new-only one-page access; independent tabs with/without same cookies denied, reload/close/reopen denied, active upload/inline protected image and reply; registration and same-history account return; exact top copy, keyboard; ordinary and opted-in shared independently retained access without signup.");
}finally{await browser?.close();process.kill(-fixture.pid,"SIGTERM");}
