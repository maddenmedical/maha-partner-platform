import express, {type Express, type RequestHandler} from "express";
import {createHash, randomUUID} from "node:crypto";
import {mkdir, readFile, rename, unlink, writeFile} from "node:fs/promises";
import path from "node:path";
import {DB_FILE_PATH,storage} from "./storage";
import {PILOT_APK_NAME,PILOT_APK_MIME} from "../shared/widgetInstaller";

// A single reviewed private pilot, not a general file host or attachment uploader.
const sha256="65c9b0b1bed727fa9973e4d6fb63815877e5db9ef7113ef5e32e399cbf501fc0";
const approved=(bytes:Buffer)=>bytes.length===161129 && createHash("sha256").update(bytes).digest("hex")===sha256;
const route=`/admin/widget-download/:dm/${PILOT_APK_NAME}`;

export function registerWidgetInstaller(app:Express,requireAuth:RequestHandler,requireAdmin:RequestHandler){
  const directory=path.join(path.dirname(path.resolve(DB_FILE_PATH)),".maha-private-widget");
  const access=(write:boolean):RequestHandler=>async(req,res,next)=>{
    const pair=/^([1-9]\d*):([1-9]\d*)$/.exec(process.env.MAHA_WIDGET_DELIVERY_PAIR??"");
    const id=Number(req.params.dm);
    if(!pair || !/^[1-9]\d*$/.test(String(req.params.dm)) || !Number.isSafeInteger(id))return void res.sendStatus(404);
    const [issuer,recipient]=pair.slice(1).map(Number);
    if(!Number.isSafeInteger(issuer)||!Number.isSafeInteger(recipient)||issuer===recipient||
      (req as any).user?.id!==(write?issuer:recipient))return void res.sendStatus(404);
    const thread=await storage.getStaffDmThread(id);
    if(!thread||!((thread.adminAId===issuer&&thread.adminBId===recipient)||(thread.adminAId===recipient&&thread.adminBId===issuer)))
      return void res.sendStatus(404);
    if(write){
      if(req.get("x-maha-widget-delivery")!=="1"||req.get("sec-fetch-site")==="cross-site")return void res.sendStatus(403);
      const origin=req.get("origin");
      if(origin && origin!==`https://${req.get("host")}` &&
        !(process.env.NODE_ENV!=="production" && origin===`http://${req.get("host")}`))return void res.sendStatus(403);
    }
    res.locals.apk=path.join(directory,`${issuer}-${recipient}-${id}-${sha256}.apk`);
    next();
  };
  const noCache:RequestHandler=(_req,res,next)=>{
    res.set({"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});next();
  };
  const auth=[noCache,requireAuth,requireAdmin];
  app.put(route,...auth,access(true),express.raw({type:PILOT_APK_MIME,limit:161129}),async(req,res)=>{
    if(!Buffer.isBuffer(req.body)||!approved(req.body))return void res.status(422).json({message:"The approved signed installer is required."});
    await mkdir(directory,{mode:0o700,recursive:true});
    const tmp=path.join(directory,randomUUID()+".tmp");
    try{await writeFile(tmp,req.body,{flag:"wx",mode:0o600});await rename(tmp,res.locals.apk);}
    finally{await unlink(tmp).catch(()=>{});}
    res.status(200).json({ready:true,sha256});
  });
  app.delete(route,...auth,access(true),async(_req,res)=>{
    try{await unlink(res.locals.apk);}catch(e:any){if(e.code!=="ENOENT")throw e;}
    res.sendStatus(204);
  });
  app.get(route,...auth,access(false),async(_req,res)=>{
    let bytes:Buffer;try{bytes=await readFile(res.locals.apk);}catch(e:any){if(e.code==="ENOENT")return void res.sendStatus(404);throw e;}
    if(!approved(bytes))return void res.sendStatus(503);
    res.set({"Content-Type":PILOT_APK_MIME,"Content-Disposition":`attachment; filename="${PILOT_APK_NAME}"`,
      "Content-Length":String(bytes.length),"Accept-Ranges":"none"}).end(bytes);
  });
}
