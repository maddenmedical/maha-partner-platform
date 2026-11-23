// Synthetic API responses only. With local Vite running on port 4237.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const base="http://127.0.0.1:4237";
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:["--no-sandbox"]});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"block"});
 const page=await ctx.newPage();page.setDefaultTimeout(10000);
 page.on("pageerror",e=>console.error(e.message));
 let signed=true,role="admin";
 const user=()=>({id:1,role,name:"Fixture Admin",status:"approved",legalAcceptedVersion:"12 September 2026",installBannerDismissedAt:1,notifyEnhancedVisibility:true});
 const ids=["a","b"].map(c=>`${c.repeat(8)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(12)}`);
 const people=["Fixture Alba","Fixture Ben"]; const notices=ids.map((id,i)=>({id:`n${i}`,title:`Invitation chat: ${people[i]}`,body:"Open this conversation to reply.",url:`/admin/#/admin/chat/invitation/${id}`,createdAt:1}));
 const links=ids.map(id=>`/admin/#/admin/chat/invitation/${id}`);
 const requests=[];
 await ctx.route("**/*",async r=>{
   const u=new URL(r.request().url()); if(u.origin!==base)return r.abort();
   const p=u.pathname;if(!p.startsWith("/api/"))return r.continue();
   requests.push(p);
   let data=[],status=200;
   if(p==="/api/auth/me"){data=user();status=signed?200:401;}
   else if(p==="/api/auth/login"){signed=true;data={user:user()};}
   else if(p.startsWith("/api/admin/")&&(!signed||role!=="admin")){status=403;data={};}
   else if(p==="/api/notifications"){data={count:2,criticalCount:0,items:notices};}
   else if(p==="/api/admin/guest-chats")data=ids.map((id,i)=>({id,label:people[i],unread:true}));
   else if(ids.includes(p.split("/").pop())&&p.startsWith("/api/admin/guest-chats/"))data={messages:[]};
   else if(p==="/api/admin/chat/threads")data=[{id:21,userId:8,userName:"Fixture Partner",kind:"general",topic:"General",messageCount:0}];
   else if(p==="/api/admin/staff-chat/dm/threads")data=[{id:31,otherAdminName:"Fixture Colleague"}];
   else if(p.endsWith("dashboard-summary"))data={};
   else if(p.endsWith("unread-count"))data={count:0};
   await r.fulfill({status,json:data});
 });
 await page.goto(base+"/admin/#/admin/chat");
 await page.getByTestId("button-notifications").click(); await page.getByTestId("notification-n1").click();
 const screen=page.getByTestId("alert-conversation");
 await screen.getByRole("heading",{name:people[1]}).waitFor();await screen.locator("textarea").first().waitFor();
 assert.equal(new URL(page.url()).hash,links[1].split("#")[1].replace(/^/,"#"));console.log("PASS mobile bell selects second invitation with reply composer");
 await page.getByRole("button",{name:`Open: Invitation chat: ${people[0]}`}).click();
 await screen.getByRole("heading",{name:people[0]}).waitFor();assert.equal(await screen.getByText(people[1]).count(),0);
 await screen.locator("textarea").first().fill("Unsent fixture draft");
 console.log("PASS foreground banner switches to first invitation; editable recipient-specific composer");
 await page.goto(base+links[1]);await screen.getByRole("heading",{name:people[1]}).waitFor();
 assert.equal(await screen.locator("textarea").first().inputValue(),"");console.log("PASS cold push destination keeps conversations and drafts separate");
 for(const [path,name] of [["thread/21","Fixture Partner"],["dm/31","Fixture Colleague"],["room/main","Staff Room"]]){
   await page.goto(`${base}/admin/#/admin/chat/${path}`);await screen.getByText(name,{exact:true}).first().waitFor();
   await screen.locator("textarea").first().waitFor();console.log(`PASS exact ${path.split("/")[0]} with composer`);
 }
 await page.goto(base+"/?thread=21#/admin/chat");await screen.getByText("Fixture Partner",{exact:true}).first().waitFor();
 await screen.getByText("Back to Chat Inbox").click();await page.getByRole("button",{name:/^Chat invitations/}).waitFor().catch(async e=>{console.error(page.url(),(await page.locator("body").innerText()).slice(-800));throw e;});
 console.log("PASS legacy reminder resolves and Back does not reopen thread");
 signed=false;await page.goto(base+links[0]);await page.locator("#email").fill("admin@example.invalid");await page.locator("#password").fill("fixture");
 await page.getByTestId("button-submit-login").click();await screen.getByRole("heading",{name:people[0]}).waitFor();
 console.log("PASS signed-out cold link resumes exact conversation after admin sign-in");
 await page.goto(base+"/admin/#/admin/chat/dm/999");await page.getByText("This conversation is unavailable",{exact:false}).waitFor();
 assert.ok(!requests.includes("/api/admin/staff-chat/dm/threads/999/messages"));console.log("PASS unavailable private DM never fetches messages");
 role="partner";await page.goto("about:blank");const before=requests.length;await page.goto(base+links[1]);await page.waitForFunction(()=>!document.querySelector('[data-testid="loader-session-restore"]')&&document.body.innerText.length>20);
 assert.equal(await screen.count(),0);assert.ok(!requests.slice(before).some(p=>p.startsWith("/api/admin/guest-chats")));
 console.log("PASS non-admin cannot open admin conversation");
}finally{await browser.close();}
