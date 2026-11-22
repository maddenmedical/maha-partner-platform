// Isolated localhost only. No production records, notifications or media.
import {chromium} from "@playwright/test";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {mkdir} from "node:fs/promises";
import assert from "node:assert/strict";
const base="http://127.0.0.1:5096",proof=process.env.QA_SCREENSHOT_DIR;
const fixture=spawn(process.execPath,["node_modules/tsx/dist/cli.mjs","script/test-events-and-invites.ts","--serve","--legacy-invitations"],{env:{...process.env,QA_PORT:"5096"},detached:true,stdio:["ignore","pipe","ignore"]});
let browser;
const examples=["Which materials should I bring to the workshop?","We’ll send the reading list here.","Thank you. I’ll check this chat for updates."];
try{
  while(!String((await once(fixture.stdout,"data"))[0]).includes("Synthetic events and chat invitations fixture")){}
  if(proof)await mkdir(proof,{recursive:true});
  browser=await chromium.launch({executablePath:process.env.QA_CHROME_PATH,args:["--no-sandbox"]});
  const call=async(path,data,cookie)=>{const res=await fetch(base+path,{method:"POST",headers:{"content-type":"application/json",cookie},body:JSON.stringify(data)});assert.ok(res.ok,`${path}: ${res.status}`);return res;};
  const admin="sid=feature-1";
  const start=async(role,width=390,height=844)=>{
    const ctx=await browser.newContext({viewport:{width,height},serviceWorkers:"block",userAgent:width<640?"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1":"Mozilla/5.0 Chrome/134"});
    await ctx.route("**/*",r=>r.request().url().startsWith(base)?r.continue():r.abort());
    if(role)await ctx.addCookies([{url:base,name:"sid",value:`feature-${role}`}]);
    const p=await ctx.newPage();p.setDefaultTimeout(9000);return p;
  };
  async function geometry(p,role,width){
    await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const log=p.getByRole("log",{name:"Messages"}).filter({visible:true});await log.waitFor();
    const ta=p.getByRole("textbox",{name:"Message",exact:true}).filter({visible:true});await ta.waitFor();
    const values=await ta.evaluate(el=>{
      const chat=el.closest(".guest-chat-frame,.chat-invite-modal,.chat-detail-pane"),frame=chat.closest(".mobile-chat-viewport")||chat;
      const form=el.closest("form"),log=chat.querySelector('[role="log"]'),r=frame.getBoundingClientRect(),f=form.getBoundingClientRect(),m=log.getBoundingClientRect();
      return {gap:r.bottom-f.bottom,outer:r.bottom,composer:f.bottom,input:el.getBoundingClientRect().bottom,log:m.height,edge:visualViewport.height+visualViewport.offsetTop,w:document.documentElement.scrollWidth,viewport:innerWidth,pageScroll:scrollY,scrollable:log.scrollHeight>log.clientHeight};
    });assert.ok(values.gap>=-2&&values.gap<24&&values.outer<=values.edge+2&&values.log>75&&values.w<=values.viewport+1&&values.pageScroll===0,`${role} ${width} ${JSON.stringify(values)}`);
    if(width<640)assert.ok(values.edge-values.outer<3,`mobile bottom ${role}: ${JSON.stringify(values)}`);
    return values;
  }
  const guest=await(await call("/api/admin/guest-chats",{label:"Workshop guest",topic:"Workshop information",message:"Welcome to MAHA. We can help with workshop questions here.",intendedUserId:null},admin)).json();
  const pg=await start(null);await pg.goto(base+guest.path);await pg.getByRole("button",{name:"Start chat"}).click();
  await pg.getByRole("textbox",{name:"Message",exact:true}).waitFor();const gstCookie=(await pg.context().cookies()).filter(c=>c.name.startsWith("maha_guest_")).map(c=>`${c.name}=${c.value}`).join("; ");
  for(let i=0;i<12;i++)await call(i%2?`/api/admin/guest-chats/${guest.id}/reply`:`/api/guest-chat/${guest.id}/message`,{requestId:randomUUID(),body:examples[i%3]},i%2?admin:gstCookie);
  await pg.reload();await pg.getByTestId("guest-register-nudge").waitFor();const registry=pg.getByRole("button",{name:"Register & keep this chat"}),install=pg.getByRole("button",{name:"Add to iPhone"});
  const contrast=async b=>b.evaluate(el=>{const s=getComputedStyle(el);const l=c=>c.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(v=>v<=0.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);return (Math.max(l(s.color),l(s.backgroundColor))+.05)/(Math.min(l(s.color),l(s.backgroundColor))+.05);});
  for(const dark of [false,true]){await pg.evaluate(d=>document.documentElement.classList.toggle("dark",d),dark);assert.ok(await contrast(registry)>=4.5);assert.ok(await contrast(install)>=4.5);}
  assert.equal(await pg.getByText(/Photos, documents, video/).count(),0);
  const g=await geometry(pg,"guest",390);assert.ok(g.scrollable);if(proof)await pg.screenshot({path:proof+"/guest-phone.png"});
  const em=await pg.context().newCDPSession(pg);await em.send("Emulation.setSafeAreaInsetsOverride",{insets:{top:24,bottom:30}});await geometry(pg,"guest safe area",390);
  const insets=await pg.evaluate(()=>({menu:document.querySelector(".guest-chat-frame header").getBoundingClientRect().top,field:document.querySelector(".guest-chat-frame textarea").getBoundingClientRect().bottom}));assert.ok(insets.menu>=24&&insets.field<=844-30,JSON.stringify(insets));await em.send("Emulation.setSafeAreaInsetsOverride",{insets:{}});
  await pg.getByTestId("button-invite-guest-mic").waitFor();await pg.getByTestId("input-invite-guest-attachment").setInputFiles({name:"workshop.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6TUAAAAASUVORK5CYII=","base64")});await pg.getByTestId("invite-guest-pending-attachment").waitFor();
  await pg.getByRole("button",{name:"Chat options"}).click();await pg.getByText(/Photos, documents, video/).waitFor();await pg.getByRole("button",{name:"Notify me when MAHA replies"}).waitFor();await pg.keyboard.press("Escape");
  await pg.getByTestId("invite-guest-pending-attachment").waitFor();await pg.getByTestId("invite-guest-remove-attachment").click();
  await pg.getByRole("textbox",{name:"Message",exact:true}).fill("Unsent workshop question");
  await pg.setViewportSize({width:320,height:430});await geometry(pg,"guest keyboard size",320);
  const [x,y]=await Promise.all([registry.boundingBox(),install.boundingBox()]);assert.ok(Math.abs(x.y-y.y)<2&&y.x+y.width<=320);assert.equal(await pg.getByRole("textbox",{name:"Message",exact:true}).inputValue(),"Unsent workshop question");
  // Simulate Safari's visual-only keyboard resize + pan while layout remains 844.
  await pg.setViewportSize({width:390,height:844});await pg.evaluate(()=>{Object.defineProperties(visualViewport,{height:{value:405,configurable:true},offsetTop:{value:34,configurable:true}});visualViewport.dispatchEvent(new Event("resize"));});await geometry(pg,"guest visual keyboard",390);
  await pg.evaluate(()=>{dispatchEvent(new Event("appinstalled"));});assert.equal(await install.count(),0);await registry.waitFor();
  const ids={};for(const [role,id] of [["partner",2],["student",7]]){const cookie=`sid=feature-${id}`;const t=await(await call("/api/chat/threads",{topic:role==="partner"?"Workshop preparation":"Institute workshop"},cookie)).json();ids[role]=t.id;for(let i=0;i<14;i++)await call(`/api/${i%2?"admin/chat":"chat"}/threads/${t.id}/messages`,{body:examples[i%3]},i%2?admin:cookie);}
  for(const width of [390,1280]){
    const p=await start(1,width);await p.goto(base+"/#/admin/chat");await p.getByRole("button",{name:/Chat invitations/}).click();await p.getByRole("button",{name:/Workshop guest/}).click();
    await geometry(p,"admin guest",width);assert.equal(await p.getByRole("button",{name:"Connect to a partner account"}).count(),0);if(proof)await p.screenshot({path:`${proof}/admin-invitation-${width}.png`});
    await p.getByRole("button",{name:"Invitation options"}).click();await p.getByRole("button",{name:"Connect to a partner account"}).waitFor();await p.getByText("End invitation access").waitFor();await p.getByRole("link",{name:"Remind via WhatsApp"}).waitFor();await p.keyboard.press("Escape");await p.getByRole("button",{name:"Back to invitations"}).click();await p.getByRole("button",{name:"Close",exact:true}).click();
    for(const [role,id] of [["admin",1],["partner",2],["student",7]]){
      const pp=role==="admin"?p:await start(id,width);
      await pp.goto(base+(role==="admin"?"/#/admin/chat":"/#/chat"));
      await pp.getByTestId(`button-thread-${ids[role==="student"?"student":"partner"]}`).click();
      await geometry(pp,role,width);assert.equal(await pp.getByRole("button",{name:"Register & keep this chat"}).count(),0);
      const ins=pp.getByRole("button",{name:width===390?"Add to iPhone":"Install MAHA",exact:true}).filter({visible:true});await ins.waitFor();
      const field=pp.getByRole("textbox",{name:"Message",exact:true}).filter({visible:true});
      if(proof)await pp.screenshot({path:`${proof}/${role}-${width}.png`});
      if(width===390){await field.fill("Local unsent draft");await pp.setViewportSize({width:320,height:430});await geometry(pp,role+" keyboard",320);assert.equal(await field.inputValue(),"Local unsent draft");}
      const options=pp.getByRole("button",{name:role==="admin"?"Conversation details":"Conversation options"}).filter({visible:true});await options.click();await pp.getByPlaceholder("Search messages...").filter({visible:true}).waitFor();await pp.keyboard.press("Escape");
      if(width===390)await pp.getByTestId("button-close-thread-mobile").filter({visible:true}).click();
      await pp.context().close();
    }
  }
  console.log("PASS: guest, admin invitation, partner, student and admin-member layout; phone/desktop, 320×430 keyboard-size, visual viewport resize/pan, bottom composer, internal scrolling, top actions, contrast in both themes, installed state, menus, drafts, Back. Synthetic only.");
}finally{await browser?.close();process.kill(-fixture.pid,"SIGTERM");}
