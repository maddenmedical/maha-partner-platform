import {sqliteDb} from "./storage";
type Message={id:number;senderRole:string;deletedAt?:number|null;createdAt:number};
export function recordInboxRead(adminId:number,conversation:string,messageId:number){
  if(!messageId)return;
  sqliteDb.prepare(`INSERT INTO admin_inbox_reads(id,admin_id,conversation,message_id) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET message_id=excluded.message_id WHERE excluded.message_id>admin_inbox_reads.message_id`)
    .run(`${adminId}:${conversation}`,adminId,conversation,messageId);
}
export function memberReadCursors(adminId:number){
  const list=sqliteDb.prepare("SELECT conversation,message_id AS cursor FROM admin_inbox_reads WHERE admin_id=?").all(adminId) as {conversation:string;cursor:number}[];
  return new Map(list.map(r=>[r.conversation,r.cursor]));
}
export function memberUnread(id:number,legacyReadAt:number|null,messages:Message[],reads:Map<string,number>){
  const cursor=reads.get(`thread:${id}`);
  return messages.some(m=>m.senderRole!=="admin"&&!m.deletedAt&&
    (cursor===undefined ? m.createdAt>(legacyReadAt||0) : m.id>cursor));
}
export function inboxInvitations(adminId:number){
  // No transcript, invitation token, topic, phone, email or attachment data.
  const list=sqliteDb.prepare(`SELECT i.id, i.label, MAX(COALESCE(i.opened_at,i.created_at),MAX(COALESCE(m.created_at,i.created_at))) AS lastMessageAt,
    MAX(CASE WHEN m.sender_role='guest' THEN m.id ELSE 0 END)>COALESCE(r.message_id,0) AS unread
    FROM guest_chat_invites i
    LEFT JOIN guest_chat_messages m ON m.invite_id=i.id AND m.deleted_at IS NULL
    LEFT JOIN admin_inbox_reads r ON r.id=?||i.id
    WHERE i.linked_thread_id IS NULL AND i.revoked_at IS NULL AND i.declined_at IS NULL
    GROUP BY i.id HAVING i.opened_at IS NOT NULL OR MAX(CASE WHEN m.sender_role='guest' THEN 1 ELSE 0 END)>0
    ORDER BY lastMessageAt DESC,i.id`).all(`${adminId}:invite:`) as {id:string;label:string;lastMessageAt:number;unread:number}[];
  return list.map(x=>{
    const label=x.label.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g," ").trim();
    return {...x,label:!label||/@|https?:\/\/|(?:\d[\s().+-]*){6}/i.test(label)?"Invited contact":label.slice(0,80),unread:!!x.unread};
  });
}
export function carryInvitationReads(id:string,thread:number,mapping:Map<number,number>){
  const list=sqliteDb.prepare("SELECT admin_id AS admin,message_id AS cursor FROM admin_inbox_reads WHERE conversation=?").all(`invite:${id}`) as {admin:number;cursor:number}[];
  for(const r of list){const transferred=mapping.get(r.cursor);if(transferred)recordInboxRead(r.admin,`thread:${thread}`,transferred);}
}
