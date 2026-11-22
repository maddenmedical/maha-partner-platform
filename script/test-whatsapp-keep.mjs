// Synthetic localhost only. The fixture mocks all mail/Drive calls and no
// browser request can reach WhatsApp, notification endpoints or real people.
import {chromium} from "@playwright/test";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {randomUUID,createECDH,randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import assert from "node:assert/strict";
const base="http://127.0.0.1:5089";
const fixture=spawn(process.execPath,["node_modules/tsx/dist/cli.mjs","script/test-events-and-invites.ts","--serve"],{env:{...process.env,QA_PORT:"5089"},detached:true,stdio:["ignore","pipe","ignore"]});
let browser;
try {
  while(!String((await once(fixture.stdout,"data"))[0]).includes("Synthetic events and chat invitations fixture")){}
  browser=await chromium.launch({executablePath:process.env.QA_CHROME_PATH||undefined,args:["--no-sandbox"]});
  async function req(path,data,auth=true){const res=await fetch(base+path,{method:data===undefined?"GET":"POST",headers:{"Content-Type":"application/json",...(auth?{cookie:"sid=feature-1"}:{})},body:data===undefined?undefined:JSON.stringify(data)});assert.ok(res.ok,`${path}: ${res.status}`);return res.json();}
  async function invite(label){return req("/api/admin/guest-chats",{label,topic:"Partner support",message:"Synthetic welcome",intendedUserId:null});}
  async function context(width){const c=await browser.newContext({viewport:{width,height:844},serviceWorkers:"block"});await c.route("**/*",r=>r.request().url().startsWith(base)?r.continue():r.abort());return c;}
  const admin=await context(1280);await admin.addCookies([{url:base,name:"sid",value:"feature-1"}]);
  for (const width of [390,1280]) {
    const person=await invite("Synthetic contact "+width), ctx=await context(width),p=await ctx.newPage(),errors=[];
    p.on("pageerror",e=>errors.push(e.message));const email=`new-${width}@example.invalid`;
    if(width===390) await p.addInitScript(()=>Object.defineProperty(navigator,"userAgent",{value:"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"}));
    await p.goto(base+person.path);await p.getByRole("button",{name:"Start chat"}).click();
    const composer=p.getByTestId("textarea-invite-guest-message");await composer.fill("Synthetic platform question");
    await p.getByTestId("button-invite-guest-send").click();await p.getByText("Your message is with MAHA.",{exact:false}).waitFor();
    await composer.fill("Synthetic unsent draft");
    await req(`/api/admin/guest-chats/${person.id}/reply`,{body:"Synthetic private reply",requestId:randomUUID()});
    const adminPage=await admin.newPage();await adminPage.goto(base+"/#/admin/chat");await adminPage.getByRole("button",{name:/Chat invitations/i}).click();
    await adminPage.getByRole("button",{name:new RegExp("Synthetic contact "+width)}).click();
    await adminPage.getByRole("button",{name:"Invitation options"}).click();const remind=adminPage.getByRole("link",{name:"Remind via WhatsApp"});await remind.waitFor();const target=new URL(await remind.getAttribute("href"));
    assert.equal(target.origin,"https://wa.me");assert.equal(target.pathname,"/");assert.deepEqual([...target.searchParams.keys()],["text"]);
    assert.doesNotMatch(target.searchParams.get("text"),/https?:|synthetic|[0-9]|Partner support/i);assert.equal(await remind.getAttribute("target"),"_blank");
    await adminPage.close(); // DO NOT open WhatsApp.
    if(width===390){await p.getByRole("button",{name:"Add to iPhone"}).click();await p.getByText("Share → Add to Home Screen → Add").waitFor();assert.equal(await p.getByRole("button",{name:"Install on Android"}).count(),0);await p.getByRole("button",{name:"Done",exact:true}).click();}
    else{for(const outcome of ["dismissed","accepted"]){await p.evaluate(outcome=>{const e=new Event("beforeinstallprompt",{cancelable:true});e.prompt=async()=>{window.__invoked=(window.__invoked||0)+1;};e.userChoice=Promise.resolve({outcome});dispatchEvent(e);},outcome);await p.getByRole("button",{name:"Install MAHA",exact:true}).click();await p.getByText(outcome==="accepted"?/Installation requested/:/In Chrome, tap/).waitFor();await p.getByRole("button",{name:"Done",exact:true}).click();}assert.equal(await p.evaluate(()=>window.__invoked),2);}
    await p.clock.install();await p.getByRole("button",{name:"Not now"}).click();assert.equal(await p.getByTestId("guest-register-nudge").count(),0);
    await p.clock.fastForward(610000);await p.getByTestId("guest-register-nudge").waitFor();assert.equal(await composer.inputValue(),"Synthetic unsent draft");
    await p.getByRole("button",{name:"Register & keep this chat"}).click();await p.getByLabel("Email address").fill(email);
    await p.getByRole("button",{name:"Email me a verification code"}).click();
    const {code}=await req("/__qa/last-code",undefined,false);await p.getByLabel("Verification code",{exact:true}).fill(code);
    await p.locator("#guest-first").fill("Demo");await p.locator("#guest-last").fill("Partner");await p.getByRole("checkbox").check();
    await p.getByRole("button",{name:"Verify and keep my chat"}).click();await p.getByTestId("saved-chat-notifications").waitFor();
    assert.ok(p.url().endsWith("#/chat"));if(width===390)await p.getByText(/For reply alerts on iPhone/).waitFor();
    if(width===1280) {
      // Native permission blocked in test browser. It must remain in chat and
      // provide useful feedback rather than claim success or change preferences.
      const enable=p.getByRole("button",{name:"Enable reply notifications"});if(await enable.isVisible()){await enable.click();await p.locator('[data-testid="saved-chat-notifications"] [role=status]').waitFor();}
    }
    await p.getByRole("button",{name:"Continue chatting",exact:true}).click();
    await p.getByText("Synthetic private reply",{exact:true}).filter({visible:true}).last().waitFor({timeout:8000});
    const memberText=p.locator("textarea:visible");assert.equal(await memberText.inputValue(),"Synthetic unsent draft");
    const active=await p.evaluate(async()=>await(await fetch("/api/auth/me")).json());
    assert.equal(active.email,email);const stored=await req("/api/admin/guest-chats");assert.ok(stored.find(x=>x.id===person.id).linkedThreadId);
    assert.equal(stored.find(x=>x.id===person.id).canRemind,false);assert.deepEqual(errors,[]);
    await ctx.close();
  }
  const logged=await context(390);await logged.addCookies([{url:base,name:"sid",value:"feature-2"}]);
  const i=await invite("Existing partner");const p=await logged.newPage();await p.goto(base+i.path);await p.getByRole("button",{name:"Open in my signed-in partner account"}).click();await p.getByTestId("saved-chat-notifications").waitFor();
  assert.ok(p.url().endsWith("#/chat"));assert.equal(await p.getByText("Verification code",{exact:true}).count(),0);
  const original=await context(390),op=await original.newPage(),inv=await invite("Continuity");
  await op.addInitScript(()=>Object.defineProperty(navigator,"userAgent",{value:"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0 Mobile Safari/537.36"}));
  await op.goto(base+inv.path);await op.getByRole("button",{name:"Start chat"}).click();
  await op.getByRole("button",{name:"Install on Android"}).click();await op.getByText(/In Chrome, tap/).waitFor();assert.equal(await op.getByRole("button",{name:"Add to iPhone"}).count(),0);await op.getByRole("button",{name:"Done",exact:true}).click();
  await op.getByTestId("textarea-invite-guest-message").fill("Synthetic retained conversation");await op.getByTestId("button-invite-guest-send").click();
  await op.getByTestId("guest-register-nudge").waitFor();await op.goto(base+"/?app=partner");await op.getByText("Synthetic retained conversation",{exact:true}).last().waitFor();assert.ok(op.url().endsWith(`/guest-chat/${inv.id}`));
  const additional=await invite("Other saved guest");await op.goto(base+additional.path);await op.getByRole("button",{name:"Start chat"}).click();await op.getByRole("button",{name:"Chat options"}).click();await op.getByRole("button",{name:"Notify me when MAHA replies"}).waitFor();await op.goto(base+"/?app=partner");await op.getByRole("heading",{name:"Choose your saved guest chat"}).waitFor();assert.equal(await op.getByRole("link",{name:/Chat [12] · Last opened/}).count(),2);
  await op.goto(base+"/#/guest-chat/"+inv.id);await op.getByRole("button",{name:"Chat options"}).click();await op.getByText("Move chat to the installed app",{exact:true}).click();await op.getByRole("button",{name:"Get one-time device code"}).click();
  const deviceCode=await op.locator("code").innerText();const isolated=await context(390),app=await isolated.newPage();
  const point=createECDH("prime256v1");point.generateKeys();const sub={endpoint:"https://web.push.apple.com/synthetic-device-apple",keys:{p256dh:point.getPublicKey().toString("base64url"),auth:randomBytes(16).toString("base64url")}};
  await app.addInitScript(sub=>{
    Object.defineProperty(navigator,"userAgent",{value:"iPhone"});Object.defineProperty(navigator,"standalone",{value:true});
    Object.defineProperty(window,"Notification",{value:{permission:"default",requestPermission:async()=>{window.__ask=(window.__ask||0)+1;return Notification.permission==="denied"?"denied":"granted";}}});
    Object.defineProperty(window,"PushManager",{value:class{}});
    Object.defineProperty(navigator,"serviceWorker",{value:{addEventListener(){},register:async()=>({}),ready:Promise.resolve({pushManager:{getSubscription:async()=>null,subscribe:async()=>({toJSON:()=>sub})}})}});
  },sub);
  await app.goto(base+"/?app=partner");await app.getByText("Move my guest chat to this app",{exact:true}).click();await app.getByLabel("One-time device code").fill(deviceCode);await app.getByRole("button",{name:"Open my chat"}).click();await app.getByText("Synthetic retained conversation",{exact:true}).last().waitFor();
  await app.getByRole("button",{name:"Chat options"}).click();assert.equal(await app.evaluate(()=>window.__ask||0),0);await app.evaluate(()=>Notification.permission="denied");await app.getByRole("button",{name:"Notify me when MAHA replies"}).click();await app.getByText(/Notifications are blocked/).waitFor();await app.evaluate(()=>Notification.permission="default");
  await app.getByRole("button",{name:"Notify me when MAHA replies"}).click();await app.getByRole("button",{name:"Turn off guest reply notifications"}).waitFor();assert.equal(await app.evaluate(()=>window.__ask),1);
  await req(`/api/admin/guest-chats/${inv.id}/reply`,{body:"Synthetic private push reply",requestId:randomUUID()});const notice=(await req("/__qa/notices",undefined,false)).at(-1);assert.equal(notice.endpoint,sub.endpoint);assert.ok(!JSON.stringify(notice.payload).includes("Synthetic"));
  const handlers={},shown=[],opened=[];const worker=await readFile("client/public/sw.js","utf8");
  vm.runInNewContext(worker,{URL,self:{addEventListener:(t,h)=>handlers[t]=h,registration:{scope:base+"/",pushManager:{getSubscription:async()=>sub},showNotification:async(...args)=>shown.push(args)},location:{origin:base},clients:{matchAll:async()=>[],openWindow:async u=>opened.push(u)}},fetch:(url,options)=>isolated.request.fetch(url.href,{method:options.method,headers:options.headers,data:options.body}).then(r=>({ok:r.ok()}))});
  let done;handlers.push({data:{json:()=>notice.payload},waitUntil:p=>done=p});await done;assert.equal(shown.length,1);handlers.notificationclick({notification:{close(){},data:shown[0][1].data},waitUntil:p=>done=p});await done;assert.deepEqual(opened,[base+`/#/guest-chat/${inv.id}`]);await app.goto(opened[0]);await app.getByText("Synthetic private push reply",{exact:true}).last().waitFor();
  await app.getByRole("button",{name:"Chat options"}).click();await app.getByRole("button",{name:"Turn off guest reply notifications"}).click();await app.getByRole("button",{name:"Notify me when MAHA replies"}).waitFor();handlers.push({data:{json:()=>notice.payload},waitUntil:p=>done=p});await done;assert.equal(shown.length,1);
  await op.goto(base+"/#/guest-chat/"+inv.id);await op.getByText("Return to your conversation",{exact:true}).waitFor();assert.equal(await op.getByText("Synthetic retained conversation",{exact:true}).count(),0);
  console.log("PASS: mobile and desktop invite registration, transcript and draft, recurring reminders, iPhone actions and Chromium prompt invocation (injected event, accepted/dismissed), own-device launch/chooser, isolated handoff, gesture → permission → mock push → production worker → tap → authorized chat, opt-out and denied recovery; no external sends.");
} finally {if(browser)await browser.close();process.kill(-fixture.pid,"SIGTERM");}
