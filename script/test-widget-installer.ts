// Local synthetic DM, real production-built React UI, actual signed private file.
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createServer} from "node:http";
import express from "express";
import {chromium,devices} from "playwright";
import {PILOT_APK_MIME,PILOT_APK_NAME,pilotDownloadPath} from "../shared/widgetInstaller";
import {serveStatic} from "../server/static";
const apk=await readFile(process.env.MAHA_QA_APK!);
const dir=await mkdtemp(path.join(tmpdir(),"maha-installer-qa-"));
process.env.NODE_ENV="test";process.env.SQLITE_DB_PATH=path.join(dir,"data.db");
process.env.MAHA_WIDGET_DELIVERY_PAIR="1:2";
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{if(!String(input).startsWith("http://127.0.0.1:"))throw Error("External network disabled");return originalFetch(input,init);};
const {db,sqliteDb}=await import("../server/storage"),s=await import("../shared/schema");
const {CURRENT_LEGAL_VERSION}=await import("../shared/legalVersion"),{registerRoutes}=await import("../server/routes");
for(const id of [1,2,3,4]){
  const now=Date.now();
  db.insert(s.users).values({id,name:`Fixture ${id}`,role:id===4?"partner":"admin",status:"approved",email:`qa${id}@example.invalid`,passwordHash:"fixture",createdAt:now,legalAcceptedVersion:CURRENT_LEGAL_VERSION,installBannerDismissedAt:now,pushNudgeLastPromptedAt:now}).run();
  db.insert(s.sessions).values({token:`qa-${id}`,userId:id,expiresAt:now+86400000}).run();
}
db.insert(s.sessions).values({token:"qa-5",userId:2,impersonatingUserId:4,expiresAt:Date.now()+86400000}).run();
const app=express();app.use(express.json());const server=createServer(app);await registerRoutes(server,app);
serveStatic(app,path.resolve("dist/public"));
await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
async function post(p:string,body:object){const r=await fetch(base+p,{method:"POST",headers:{cookie:"sid=qa-1","Content-Type":"application/json"},body:JSON.stringify(body)});assert.ok(r.ok);return r.json();}
const thread=(await post("/api/admin/staff-chat/dm/threads",{otherAdminId:2})).id;
const other=(await post("/api/admin/staff-chat/dm/threads",{otherAdminId:3})).id;
const p=pilotDownloadPath(thread);
const req=(id:number,method="GET",url=p,body?:Buffer,extra:Record<string,string>={})=>fetch(base+url,{method,
  headers:{cookie:id?`sid=qa-${id}`:"","x-maha-widget-delivery":"1","content-type":PILOT_APK_MIME,...extra},body:body&&new Uint8Array(body)});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,args:["--no-sandbox"]});
try{
  assert.equal((await req(2)).status,404);
  for(const id of [2,3])assert.equal((await req(id,"PUT",p,apk)).status,404);
  assert.equal((await req(1,"PUT",p,apk,{origin:"https://example.invalid"})).status,403);
  assert.equal((await req(1,"PUT",p,apk,{"x-maha-widget-delivery":""})).status,403);
  assert.equal((await req(1,"PUT",p,Buffer.from("unapproved"))).status,422);
  assert.equal((await req(1,"PUT",p,apk)).status,200);
  const privateDir=path.join(dir,".maha-private-widget");
  assert.equal((await stat(privateDir)).mode&0o777,0o700);
  for(const [id,status] of [[0,401],[1,404],[3,404],[4,403],[5,403]])assert.equal((await req(id)).status,status);
  assert.equal((await req(2,"GET",pilotDownloadPath(other))).status,404);
  const body=`Install the MAHA Chat Widget for Android:\n${base+p}\nPlease reply “installed” when ready.`;
  await post(`/api/admin/staff-chat/dm/threads/${thread}/messages`,{body});
  await post(`/api/admin/staff-chat/dm/threads/${other}/messages`,{body});
  const ctx=await browser.newContext({...devices["Pixel 7"],acceptDownloads:true});
  await ctx.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await ctx.addCookies([{name:"sid",value:"qa-2",url:base,httpOnly:true,sameSite:"Lax"}]);
  const page=await ctx.newPage();const entry=base+`/admin/#/admin/chat/dm/${thread}`;await page.goto(entry);
  const a=page.getByRole("link",{name:"Download MAHA Chat Widget for Android"});await a.waitFor();
  assert.equal(await a.getAttribute("href"),p);assert.equal(await a.getAttribute("target"),null);
  const [download,response]=await Promise.all([page.waitForEvent("download"),page.waitForResponse(r=>r.url()===base+p),a.tap()]);
  assert.equal(response.status(),200);assert.equal(response.headers()["content-type"],PILOT_APK_MIME);
  assert.equal(response.headers()["cache-control"],"private, no-store");
  assert.equal(download.suggestedFilename(),PILOT_APK_NAME);assert.deepEqual(await readFile((await download.path())!),apk);
  assert.equal(ctx.pages().length,1);assert.equal(page.url(),entry);
  if(process.env.MAHA_QA_INSTALLED){
    const desktop=await chromium.launchPersistentContext(path.join(dir,"qa-chrome"),{headless:false,viewport:null,executablePath:process.env.CHROME_PATH,args:["--no-sandbox","--disable-background-networking"],acceptDownloads:true});
    try{
      await desktop.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
      await desktop.addCookies([{name:"sid",value:"qa-2",url:base,httpOnly:true,sameSite:"Lax"}]);
      const seed=await desktop.newPage();await seed.goto(entry);await seed.getByRole("link",{name:"Download MAHA Chat Widget for Android"}).waitFor();
      const cdp=await desktop.newCDPSession(seed);const manifestId=base+"/admin/";
      await cdp.send("PWA.install",{manifestId,installUrlOrBundleUrl:manifestId});
      await cdp.send("PWA.changeAppUserSettings",{manifestId,displayMode:"standalone"});
      await cdp.send("PWA.openCurrentPageInApp",{manifestId});
      let installed;
      for(let i=0;i<25&&!installed;i++){
        for(const candidate of desktop.pages()){
          if(candidate.isClosed())continue;
          if(await candidate.evaluate(()=>matchMedia("(display-mode: standalone)").matches).catch(()=>false)){installed=candidate;break;}
        }
        if(!installed)await desktop.waitForEvent("page",{timeout:300}).catch(()=>{});
      }
      assert.ok(installed,"Installed app target not found");
      await installed.getByRole("link",{name:"Download MAHA Chat Widget for Android"}).waitFor();
      await installed.waitForFunction(()=>matchMedia("(display-mode: standalone)").matches,null,{timeout:5000});
      const count=desktop.pages().length;
      const [saved]=await Promise.all([installed.waitForEvent("download"),installed.getByRole("link",{name:"Download MAHA Chat Widget for Android"}).click()]);
      assert.deepEqual(await readFile((await saved.path())!),apk);assert.equal(installed.url(),entry);assert.equal(desktop.pages().length,count);
      await cdp.send("PWA.uninstall",{manifestId});console.log("PASS: genuinely installed Chromium standalone MAHA Admin PWA, already signed-in app window saved identical bytes without opening external browser.");
    }finally{await desktop.close();}
  }
  assert.equal((await req(2,"DELETE")).status,404);assert.equal((await req(1,"DELETE")).status,204);
  await a.tap();await page.getByRole("alert").filter({hasText:"private download is unavailable"}).waitFor();
  await ctx.clearCookies();await ctx.addCookies([{name:"sid",value:"qa-3",url:base,httpOnly:true,sameSite:"Lax"}]);
  await page.goto(base+`/admin/#/admin/chat/dm/${other}`);await page.getByText("Please reply", {exact:false}).first().waitFor();
  assert.equal(await a.count(),0);
  console.log("PASS: signed-in mobile Chromium tap in actual staff DM UI downloaded exact approved bytes; recipient only; no sign-in, navigation or new tab; copied link in different DM inert; revocation, wrong session, impersonation, payload and origin checks.");
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));sqliteDb.close();await rm(dir,{recursive:true,force:true});}
