import {createHash} from "node:crypto";
import type {Express,RequestHandler} from "express";
import {sqliteDb} from "./storage";
import {unreadSummary,unreadRows} from "./adminInbox";
const hex=/^[a-f0-9]{64}$/;
const digest=(secret:string)=>createHash("sha256").update(secret).digest("hex");
// Pending phone requests vanish on restart; never grant a right by themselves.
const pending=new Map<string,number>(),rate=new Map<string,{n:number;until:number}>();
const namesRequests=new Map<string,{device:string;until:number}>();
const rowRef=(device:string,scope:string,path:string)=>digest([device,scope,path].join("/")).slice(0,32);
function contact(path:string){
  const [, , ,kind,key]=path.split("/");
  const invite=kind==="invitation";
  // Only the account's identity field or staff-assigned invited contact label.
  const result=sqliteDb.prepare(invite?"SELECT label AS name FROM guest_chat_invites WHERE id=?":
    "SELECT u.name FROM users u JOIN chat_threads t ON t.user_id=u.id WHERE t.id=?").get(key) as {name?:string}|undefined;
  const name=(result?.name||"").normalize("NFC").trim();
  const personal=name.replace(/^(?:(?:Dr|Prof)\.\s+){1,2}/i,"");
  const fallback=invite?"Invited guest":"MAHA member";
  // Conservative name-only form. Reject links, identifiers, notes, punctuation,
  // numerical data and obvious descriptors instead of trying to redact them.
  return name.length<=54&&personal.split(/\s+/).length<=4&&new RegExp("^[\\p{L}\\p{M}]+(?:[ ’'-][\\p{L}\\p{M}]+){0,6}$","u").test(personal)&&
    !/\b(patient|diagnosis|referral|case|treatment|urgent|follow.up|surgery|implant|whatsapp|private|note|call|review)\b/i.test(name)?name:fallback;
}
export function registerWidget(app:Express,...auth:RequestHandler[]){
  const noStore:RequestHandler=(_,res,next)=>{res.set("Cache-Control","private, no-store");next();};
  app.use(["/api/widget","/api/admin/widget"],noStore);
  const idFor=(header?:string)=>{const token=(header||"").match(/^Bearer ([0-9a-f]{64})$/)?.[1];return token?digest(token):null;};
  const valid=(id:string)=>sqliteDb.prepare(`SELECT d.admin_id admin,d.people_hash scope FROM admin_widget_devices d JOIN users u ON u.id=d.admin_id
    WHERE d.id=? AND d.revoked_at IS NULL AND u.role='admin' AND u.status='approved' AND u.archived_at IS NULL`).get(id) as {admin:number;scope:string|null}|undefined;
  const requested=(req:any)=>{const x=req.get("x-maha-names-id");return typeof x==="string"&&hex.test(x)?x:null;};
  function offer(device:string,scope:string|null){namesRequests.forEach((v,k)=>{if(v.until<=Date.now()||v.device===device)namesRequests.delete(k);});
    if(scope&&scope!==device&&namesRequests.size<2000)namesRequests.set(scope,{device,until:Date.now()+300000});}
  const postGuard:RequestHandler=(req,res,next)=>{
    const origin=req.get("origin");
    if(!req.is("application/json")||(origin&&origin!==`https://${req.get("host")}`&&
      !(process.env.NODE_ENV!=="production"&&origin===`http://${req.get("host")}`))){res.sendStatus(403);return;}next();
  };
  app.post("/api/widget/start",(req,res)=>{
    const id=idFor(req.get("authorization"));if(!id)return res.sendStatus(401);
    const now=Date.now();pending.forEach((v,k)=>{if(v<=now)pending.delete(k);});
    rate.forEach((v,k)=>{if(v.until<=now)rate.delete(k);});
    const ip=req.ip||"unknown",entry=rate.get(ip)||{n:0,until:now+600000};
    if(rate.size>=2000||pending.size>=2000||entry.n>=20)return res.sendStatus(429);entry.n++;rate.set(ip,entry);
    if(sqliteDb.prepare("SELECT 1 FROM admin_widget_devices WHERE id=?").get(id))return res.sendStatus(409);
    pending.set(id,now+300000);offer(id,requested(req));res.json({id,expiresIn:300});
  });
  app.post("/api/admin/widget/approve",...auth,postGuard,(req:any,res)=>{
    const id=req.body?.id,expires=typeof id==="string"&&hex.test(id)?pending.get(id):0;
    if(!expires||expires<=Date.now())return res.sendStatus(410);
    pending.delete(id);
    if(sqliteDb.prepare("SELECT 1 FROM admin_widget_devices WHERE id=?").get(id))return res.sendStatus(409);
    const s=req.body?.namesId,choice=typeof s==="string"&&namesRequests.get(s);
    const scope=choice&&choice.device===id&&choice.until>Date.now()&&req.body.showNames===true?s:null;
    offer(id,null);sqliteDb.prepare("INSERT INTO admin_widget_devices(id,admin_id,created_at,people_hash) VALUES(?,?,?,?)").run(id,req.user.id,Date.now(),scope||null);
    res.json({connected:true});
  });
  app.get("/api/admin/widget/devices",...auth,(req:any,res)=>{
    res.json(sqliteDb.prepare("SELECT id,created_at AS createdAt FROM admin_widget_devices WHERE admin_id=? AND revoked_at IS NULL ORDER BY created_at DESC").all(req.user.id));
  });
  app.post("/api/admin/widget/revoke",...auth,postGuard,(req:any,res)=>{
    if(!hex.test(String(req.body?.id)))return res.sendStatus(400);
    const n=sqliteDb.prepare("UPDATE admin_widget_devices SET revoked_at=? WHERE id=? AND admin_id=? AND revoked_at IS NULL").run(Date.now(),req.body.id,req.user.id);
    if(!n.changes)return res.sendStatus(404);res.json({disconnected:true});
  });
  app.get("/api/widget/snapshot",(req,res)=>{
    const id=idFor(req.get("authorization")),d=id&&valid(id);if(!d)return res.sendStatus(401);
    const {count,latestAt}=unreadSummary(d.admin);res.json({count,latestAt,checkedAt:Date.now()});
  });
  app.post("/api/widget/name-request",(req,res)=>{
    const id=idFor(req.get("authorization")),s=requested(req);
    if(!id||!valid(id))return res.sendStatus(401);if(!s||s===id)return res.sendStatus(400);
    offer(id,s);res.json({id:s});
  });
  app.post("/api/admin/widget/allow-names",...auth,postGuard,(req:any,res)=>{
    const s=req.body?.namesId,v=namesRequests.get(s),d=v&&valid(v.device);
    if(!v||v.until<=Date.now()||!d||d.admin!==req.user.id||req.body.showNames!==true)return res.sendStatus(404);
    namesRequests.delete(s);sqliteDb.prepare("UPDATE admin_widget_devices SET people_hash=? WHERE id=?").run(s,v.device);res.json({ok:true});
  });
  app.post("/api/widget/hide",(req,res)=>{
    const id=idFor(req.get("authorization"));if(!id||!valid(id))return res.sendStatus(401);
    offer(id,null);sqliteDb.prepare("UPDATE admin_widget_devices SET people_hash=NULL WHERE id=?").run(id);res.json({ok:true});
  });
  app.get("/api/widget/people",(req,res)=>{
    const id=idFor(req.get("authorization")),d=id&&valid(id),key=req.get("x-maha-names-key");
    if(!id||!d)return res.sendStatus(401);
    if(!d.scope||!key||!hex.test(key)||digest(key)!==d.scope)return res.sendStatus(403);
    const all=unreadRows(d.admin);res.json({count:all.length,latestAt:all[0]?.at??null,checkedAt:Date.now(),
      people:all.slice(0,3).map(r=>({label:contact(r.path),at:r.at,ref:rowRef(id,d.scope!,r.path)}))});
  });
  app.get("/api/admin/widget/row/:id/:ref",...auth,(req:any,res)=>{
    const {id,ref}=req.params,d=hex.test(id)&&valid(id);
    if(!d||d.admin!==req.user.id||!d.scope||!/^[a-f0-9]{32}$/.test(ref))return res.sendStatus(404);
    const row=unreadRows(d.admin).find(r=>rowRef(id,d.scope!,r.path)===ref);
    if(!row)return res.sendStatus(410);res.json({path:row.path});
  });
  app.get("/api/admin/widget/open/:id",...auth,(req:any,res)=>{
    const d=hex.test(req.params.id)&&valid(req.params.id);if(!d||d.admin!==req.user.id)return res.sendStatus(404);
    res.json({path:unreadSummary(d.admin).path});
  });
}
