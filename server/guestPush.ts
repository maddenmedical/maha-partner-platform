import crypto from "node:crypto";
import webpush from "web-push";
import {and,eq,lt,isNull} from "drizzle-orm";
import {activeGuest} from "./guestAccess";
import {z} from "zod";
import {guestChatInvites as invites,pushSubscriptions} from "@shared/schema";
import {db} from "./storage";
import {ensurePushConfigured} from "./push";

export const clearGuestPush={guestPushEndpoint:null,guestPushKeys:null,guestPushChangedAt:null};
type Invite=typeof invites.$inferSelect;
const bad=(status:number,message:string):never=>{throw Object.assign(new Error(message),{status});};
// Only fixed HTTPS push services and known delivery paths. web-push uses
// node:https.request directly and treats 3xx as errors, without following.
export function trustedGuestEndpoint(s:string){
  if(s.length>2048 || /[\s\\?#%]/.test(s))return false;
  return /^https:\/\/(?:fcm\.googleapis\.com\/(?:fcm\/send|wp)\/|web\.push\.apple\.com\/(?:Q[^/]*\/)?|updates\.push\.services\.mozilla\.com\/wpush\/v[12]\/)[A-Za-z0-9_:.-]{12,1800}$/.test(s);
}
const sub=z.object({endpoint:z.string().max(2048).refine(trustedGuestEndpoint),keys:z.object({p256dh:z.string().regex(/^[\w-]{87}$/),auth:z.string().regex(/^[\w-]{22}$/)})});
export function enrollGuest(i:Invite,input:unknown){
  if(!ensurePushConfigured())bad(503,"Notifications are not configured.");
  const {endpoint,keys}=sub.parse(input);
  try{crypto.ECDH.convertKey(Buffer.from(keys.p256dh,"base64url"),"prime256v1");}catch{bad(400,"Invalid notification key.");}
  const key=JSON.stringify(keys),now=Date.now();
  if(i.guestPushEndpoint===endpoint&&i.guestPushKeys===key)return;
  if(i.guestPushChangedAt && now-i.guestPushChangedAt<60000)bad(429,"Please wait a minute before changing notification devices.");
  db.update(invites).set(clearGuestPush).where(and(isNull(invites.guestDurableSince),lt(invites.sessionExpiresAt,now))).run();
  const other=db.select({id:invites.id}).from(invites).where(eq(invites.guestPushEndpoint,endpoint)).get();
  if((other&&other.id!==i.id)||db.select({id:pushSubscriptions.id}).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint,endpoint)).get())bad(409,"Notifications on this browser belong to another chat or account. Use a separate browser profile.");
  db.update(invites).set({guestPushEndpoint:endpoint,guestPushKeys:key,guestPushChangedAt:now}).where(eq(invites.id,i.id)).run();
}
export function activeGuestOwnsEndpoint(endpoint:string){
  const i=db.select().from(invites).where(eq(invites.guestPushEndpoint,endpoint)).get();
  return !!i&&activeGuest(i);
}
export async function notifyGuest(i:Invite){
  if(!i.sessionHash||!activeGuest(i)||!i.guestPushEndpoint||!i.guestPushKeys||!trustedGuestEndpoint(i.guestPushEndpoint)||!ensurePushConfigured())return;
  if(db.select({id:pushSubscriptions.id}).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint,i.guestPushEndpoint)).get())return;
  try{await webpush.sendNotification({endpoint:i.guestPushEndpoint,keys:JSON.parse(i.guestPushKeys)},JSON.stringify({guest:i.id,title:"MAHA",body:"MAHA replied. Open your chat.",url:`/#/guest-chat/${i.id}`}),{TTL:3600,urgency:"high",timeout:8000});}
  catch(e:any){if(e?.statusCode===404||e?.statusCode===410)db.update(invites).set(clearGuestPush).where(and(eq(invites.id,i.id),eq(invites.guestPushEndpoint,i.guestPushEndpoint),eq(invites.sessionHash,i.sessionHash))).run();}
}
