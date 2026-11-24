// Start script/test-widget.ts --serve. Browser and fixture operate on loopback only.
import assert from "node:assert/strict";
import {randomBytes,createHash} from "node:crypto";
import {chromium} from "playwright";
const base="http://127.0.0.1:5364",token=randomBytes(32).toString("hex");
const namesKey=randomBytes(32).toString("hex"),namesId=createHash("sha256").update(namesKey).digest("hex");
const start=await fetch(base+"/api/widget/start",{method:"POST",headers:{authorization:"Bearer "+token,"x-maha-names-id":namesId}});assert.equal(start.status,200);const {id}=await start.json();
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,args:["--no-sandbox"]});
try{
 const ctx=await browser.newContext({viewport:{width:360,height:780},serviceWorkers:"block"});await ctx.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const page=await ctx.newPage(),url=base+"/admin/widget-connect/"+id+"/"+namesId;
 await page.goto(url);await page.locator("#email").waitFor();assert.equal(new URL(page.url()).pathname,new URL(url).pathname);
 await page.locator("#email").fill("1@example.invalid");await page.locator("#password").fill("synthetic-widget-only");await page.getByTestId("button-submit-login").click();await page.getByText(id.slice(0,8).toUpperCase(),{exact:true}).waitFor();
 const opt=page.getByRole("checkbox",{name:/Show who/});assert.equal(await opt.isChecked(),false);await opt.check();
 await page.getByText("Connect widget",{exact:true}).click();await page.getByText("Connected. Return to the MAHA Widget app.").waitFor();
 assert.match(await page.getByText("Return to widget",{exact:true}).getAttribute("href"),/package=clinic.maha.inboxwidget/);
 const open=base+"/admin/widget-open/"+id;
 const snap=await(await fetch(base+"/api/widget/people",{headers:{authorization:"Bearer "+token,"x-maha-names-key":namesKey}})).json();
 assert.equal(snap.people[1].label,"Elias Linden");const second=open+"/"+snap.people[1].ref;
 await page.goto(second);await page.waitForURL("**/#/admin/chat/thread/*");await page.getByText("Elias Linden",{exact:true}).first().waitFor();await page.locator("textarea").first().waitFor();
 await page.goto(second);await page.getByText(/conversation is no longer waiting/).waitFor();
 await page.goto(open);await page.waitForURL("**/#/admin/chat/invitation/*");await page.getByRole("heading",{name:"Mira Adler"}).waitFor();await page.locator("textarea").first().waitFor();
 await page.goto(open);await page.waitForURL("**/#/admin/chat");await page.getByTestId("button-tab-active-chats").waitFor();
 await ctx.addCookies([{url:base,name:"sid",value:"widgetqa-2"}]);await page.goto(second);await page.getByText("This widget is not connected to this MAHA account.").waitFor();
 await ctx.addCookies([{url:base,name:"sid",value:"widgetqa-1"}]);await page.goto(base+"/admin/widget-settings");await page.getByRole("button",{name:"Disconnect"}).click();await page.getByText("Phone disconnected.").waitFor();await page.goto(open);await page.getByText("This widget is not connected to this MAHA account.").waitFor();
 console.log("PASS mobile signed-out gate, matched check approval, exact invite/member composer, empty inbox fallback, wrong account, settings revocation");
}finally{await browser.close();}
