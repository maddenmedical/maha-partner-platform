// Independent synthetic browser contexts. Localhost only; no outside delivery.
import {chromium} from "@playwright/test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
const base="http://127.0.0.1:5097";
const fixture=spawn(process.execPath,["node_modules/tsx/dist/cli.mjs","script/test-events-and-invites.ts","--serve","--legacy-invitations"],{env:{...process.env,QA_PORT:"5097"},detached:true,stdio:["ignore","pipe","ignore"]});
let browser;
try{
  while(!String((await once(fixture.stdout,"data"))[0]).includes("Synthetic events and chat invitations fixture")){}
  browser=await chromium.launch({executablePath:process.env.QA_CHROME_PATH,args:["--no-sandbox"]});
  const ctx=async()=>{const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"block"});c.setDefaultTimeout(8000);await c.route("**/*",r=>r.request().url().startsWith(base)?r.continue():r.abort());return c;};
  const a=await ctx(),old=await ctx(),fresh=await ctx(),forward=await ctx();
  await a.addCookies([{name:"sid",value:"feature-1",url:base}]);
  const created=await a.request.post(base+"/api/admin/guest-chats",{data:{label:"Recovery QA",topic:"Workshop",message:"Synthetic opening message",intendedUserId:null}});assert.equal(created.status(),201);const inv=await created.json();
  const p=await old.newPage();await p.goto(base+inv.path);await p.getByRole("button",{name:"Start chat"}).click();
  await p.getByRole("textbox",{name:"Message",exact:true}).fill("Synthetic retained question");await p.getByTestId("button-invite-guest-send").click();await p.getByText("Synthetic retained question",{exact:true}).waitFor();
  await p.goto(base+inv.path);await p.getByText("Synthetic retained question",{exact:true}).waitFor();assert.equal(await p.getByRole("button",{name:"Start chat"}).count(),0);
  const newP=await fresh.newPage(),untrusted=await forward.newPage();
  for(const page of [newP,untrusted]){await page.goto(base+inv.path);await page.getByRole("button",{name:"Restore this chat"}).click();await page.getByLabel("Matching code",{exact:true}).waitFor();assert.equal(await page.getByRole("log").count(),0);}
  const challenge=await newP.getByLabel("Matching code",{exact:true}).textContent();assert.notEqual(challenge,await untrusted.getByLabel("Matching code",{exact:true}).textContent());
  await newP.reload();await newP.getByText(challenge,{exact:true}).waitFor();
  const admin=await a.newPage();await admin.goto(base+"/#/admin/chat");await admin.getByRole("button",{name:/Chat invitations/}).click();await admin.getByRole("button",{name:/Recovery QA/}).click();await admin.getByRole("button",{name:"Invitation options"}).click();
  await admin.getByText("Restore access to this same chat",{exact:true}).click();await admin.getByLabel("Matching code from the verified recipient").fill(challenge);
  const approve=admin.getByRole("button",{name:"Approve this browser"});assert.equal(await approve.isEnabled(),false);
  await admin.getByRole("checkbox",{name:/I verified the original recipient/}).check();await approve.click();await admin.getByText(/Approved. The recipient/).waitFor();
  await newP.getByRole("button",{name:"Check approval"}).click();await newP.getByText("Synthetic retained question",{exact:true}).waitFor();
  await newP.goto(base+inv.path);await newP.getByText("Synthetic retained question",{exact:true}).waitFor();
  await untrusted.reload();await untrusted.getByRole("button",{name:"Restore this chat"}).waitFor();assert.equal(await untrusted.getByRole("log").count(),0);
  await p.goto(base+inv.path);await p.getByRole("button",{name:"Restore this chat"}).waitFor();assert.equal(await p.getByRole("log").count(),0);
  console.log("PASS: remembered original link auto-resumes; fresh browser requests, reloads same matching code, admin verifies/approves, requester alone resumes same history and bookmark. Other request and old device cannot read.");
}finally{await browser?.close();process.kill(-fixture.pid,"SIGTERM");}
