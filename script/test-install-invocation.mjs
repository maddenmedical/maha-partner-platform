// Real browser event, not a simulated BeforeInstallPromptEvent. The OS's
// final confirmation is intentionally outside the automated test boundary.
import {chromium} from "@playwright/test";
import {spawn} from "node:child_process";
import {once} from "node:events";
import assert from "node:assert/strict";
const fixture=spawn(process.execPath,["node_modules/tsx/dist/cli.mjs","script/test-events-and-invites.ts","--serve","--legacy-invitations"],{env:{...process.env,QA_PORT:"5093"},stdio:["ignore","pipe","ignore"],detached:true}),base="http://127.0.0.1:5093";
let browser;
try{
  while(!String((await once(fixture.stdout,"data"))[0]).includes("Synthetic events and chat invitations fixture")){}
  const inv=await(await fetch(base+"/api/admin/guest-chats",{method:"POST",headers:{"content-type":"application/json",cookie:"sid=feature-1"},body:JSON.stringify({label:"Local install test",topic:"Synthetic",message:"Synthetic",intendedUserId:null})})).json();
  browser=await chromium.launchPersistentContext("",{headless:!process.env.QA_HEADED,executablePath:process.env.QA_CHROME_PATH||undefined,args:["--no-sandbox","--bypass-app-banner-engagement-checks","--no-first-run"]});
  const ctx=browser;await ctx.route("**/*",r=>r.request().url().startsWith(base)?r.continue():r.abort());const p=await ctx.newPage();
  await p.addInitScript(()=>{addEventListener("beforeinstallprompt",e=>{if(!e.isTrusted)return;window.__trusted=true;const real=e.prompt.bind(e);e.prompt=function(){window.__called=!!navigator.userActivation.isActive;return real();};});});
  await p.goto(base+inv.path);await p.getByRole("button",{name:"Start chat"}).click();await p.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
  const cdp=await ctx.newCDPSession(p);console.log("Browser installability:",await cdp.send("Page.getInstallabilityErrors"));
  await p.waitForFunction(()=>window.__trusted===true,null,{timeout:15000});
  await p.getByRole("button",{name:"Install MAHA",exact:true}).click();assert.equal(await p.evaluate(()=>window.__called),true);console.log("PASS: trusted Chromium beforeinstallprompt fired and its real prompt() was called during the guest’s click. No OS confirmation asserted.");
}finally{await browser?.close();process.kill(-fixture.pid,"SIGTERM");}
