// Four independent localhost browsers; all Drive, mail and push providers mocked.
import {chromium} from "@playwright/test";
import {spawn} from "node:child_process";
import {once} from "node:events";
import assert from "node:assert/strict";
const base="http://127.0.0.1:5098";
const fixture=spawn(process.execPath,["node_modules/tsx/dist/cli.mjs","script/test-events-and-invites.ts","--serve"],{env:{...process.env,QA_PORT:"5098"},detached:true,stdio:["ignore","pipe","ignore"]});
let browser;
try{
  while(!String((await once(fixture.stdout,"data"))[0]).includes("Synthetic events and chat invitations fixture")){}
  browser=await chromium.launch({executablePath:process.env.QA_CHROME_PATH,args:["--no-sandbox"]});
  const context=async()=>{const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"block"});await c.route("**/*",r=>r.request().url().startsWith(base+"/")?r.continue():r.abort());return c;};
  const [admin,owner,a,b]=await Promise.all([context(),context(),context(),context()]);
  await admin.addCookies([{name:"sid",value:"feature-1",url:base}]);
  const r=await admin.request.post(base+"/api/admin/guest-chats",{data:{topic:"Synthetic topic",label:"Sharing QA",message:"Synthetic original history",intendedUserId:null}});
  assert.equal(r.status(),201);const i=await r.json(),ep=base+"/api/guest-chat/"+i.id;
  const old=await owner.newPage();await old.goto(base+i.path);await old.getByRole("button",{name:"Start chat"}).click();await old.getByRole("log").waitFor();
  const panel=await admin.newPage();await panel.goto(base+"/#/admin/chat");await panel.getByRole("button",{name:/Chat invitations/}).click();
  await panel.getByText("Link access: Private").click();await panel.getByRole("button",{name:"Allow anyone with this link to read and reply"}).click();await panel.getByText("Link access: Anyone with the link").waitFor();
  const pages=await Promise.all([a.newPage(),b.newPage()]);
  for(const [idx,p] of pages.entries()){
    await p.goto(base+i.path);await p.getByText("Synthetic original history",{exact:true}).waitFor();assert.equal(await p.getByRole("button",{name:/Start chat|register|restore/i}).count(),0);
    await p.getByRole("textbox",{name:"Message",exact:true}).fill("Synthetic reply "+idx);await p.getByTestId("button-invite-guest-send").click();await p.getByText("Synthetic reply "+idx,{exact:true}).waitFor();
  }
  for(const p of pages){await p.reload();await p.getByText("Synthetic reply 1",{exact:true}).waitFor();await p.getByText("Synthetic reply 0",{exact:true}).waitFor();await p.getByRole("log").getByText(/^Shared link guest\s*·/).first().waitFor();}
  const fd=await a.request.post(ep+"/upload",{multipart:{file:{name:"example.txt",mimeType:"text/plain",buffer:Buffer.from("Synthetic shared attachment")}}});assert.equal(fd.status(),200);
  const f=await fd.json();assert.equal((await b.request.get(base+f.url)).status(),403);
  assert.equal((await a.request.post(ep+"/message",{data:{requestId:crypto.randomUUID(),body:"Attached synthetic note",attachmentUrl:f.url}})).status(),200);
  assert.equal(await(await b.request.get(base+f.url)).text(),"Synthetic shared attachment");
  await panel.getByRole("button",{name:"Turn off shared access"}).click();await panel.getByText("Link access: Private").waitFor();
  for(const p of pages){await p.getByText("This shared chat is unavailable.",{exact:false}).waitFor({timeout:12000});assert.equal(await p.getByRole("log").count(),0);}
  assert.equal((await b.request.get(base+f.url)).status(),403);
  await pages[0].reload();await pages[0].getByRole("button",{name:"Restore this chat"}).waitFor();
  console.log("PASS: two fresh browsers directly read/reply, reload, see independent attribution, share attached files; admin list enables/disables, both lose transcript and file access, private restoration returns.");
}finally{await browser?.close();process.kill(-fixture.pid,"SIGTERM");}
