import type {guestChatInvites} from "@shared/schema";
type Invite=typeof guestChatInvites.$inferSelect;
// Null legacy deadlines alone never grant access. Only a first authorized
// start, deliberate move, or valid legacy credential may set the durable flag.
export function activeGuest(i:Invite,now=Date.now()){
  return !!(i.openedAt&&i.sessionHash&&!i.revokedAt&&!i.declinedAt&&!i.linkedThreadId&&
    (i.guestDurableSince!=null||(i.sessionExpiresAt??0)>now));
}
