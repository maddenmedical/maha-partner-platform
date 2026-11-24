import {sqliteDb} from "./storage";
export function recordInboxRead(adminId:number,conversation:string,messageId:number){
  if(!messageId)return;
  sqliteDb.prepare(`INSERT INTO admin_inbox_reads(id,admin_id,conversation,message_id) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET message_id=excluded.message_id WHERE excluded.message_id>admin_inbox_reads.message_id`)
    .run(`${adminId}:${conversation}`,adminId,conversation,messageId);
}
// Inbox, Home, and paired widget share these exact per-admin predicates.
export function unreadMembers(admin:number){
  return sqliteDb.prepare(`SELECT t.id,MAX(m.created_at) at FROM chat_threads t
    JOIN chat_messages m ON m.thread_id=t.id LEFT JOIN admin_inbox_reads r ON r.id=?||t.id
    WHERE m.sender_role!='admin' AND m.deleted_at IS NULL AND
    (CASE WHEN r.message_id IS NULL THEN m.created_at>COALESCE(t.admin_last_read_at,0) ELSE m.id>r.message_id END)
    GROUP BY t.id`).all(`${admin}:thread:`) as {id:number;at:number}[];
}
const eligibleInvite="i.linked_thread_id IS NULL AND i.revoked_at IS NULL AND i.declined_at IS NULL";
const newGuestMessage="m.sender_role='guest' AND m.id>COALESCE(r.message_id,0)";
export function unreadRows(admin:number){
  const guests=sqliteDb.prepare(`SELECT i.id,MAX(m.created_at) at FROM guest_chat_invites i
    JOIN guest_chat_messages m ON m.invite_id=i.id AND m.deleted_at IS NULL
    LEFT JOIN admin_inbox_reads r ON r.id=?||i.id
    WHERE ${eligibleInvite} AND ${newGuestMessage} GROUP BY i.id`).all(`${admin}:invite:`) as {id:string;at:number}[];
  return [...unreadMembers(admin).map(r=>({at:r.at,path:`/admin/chat/thread/${r.id}`})),
    ...guests.map(r=>({at:r.at,path:`/admin/chat/invitation/${r.id}`}))].sort((a,b)=>b.at-a.at||a.path.localeCompare(b.path));
}
export function unreadSummary(admin:number){
  const rows=unreadRows(admin);return {count:rows.length,latestAt:rows[0]?.at??null,path:rows[0]?.path??"/admin/chat"};
}
export function inboxInvitations(adminId:number){
  // No transcript, invitation token, topic, phone, email or attachment data.
  const list=sqliteDb.prepare(`SELECT i.id, i.label, MAX(COALESCE(i.opened_at,i.created_at),MAX(COALESCE(m.created_at,i.created_at))) AS lastMessageAt,
    MAX(CASE WHEN ${newGuestMessage} THEN 1 ELSE 0 END) AS unread
    FROM guest_chat_invites i
    LEFT JOIN guest_chat_messages m ON m.invite_id=i.id AND m.deleted_at IS NULL
    LEFT JOIN admin_inbox_reads r ON r.id=?||i.id
    WHERE ${eligibleInvite}
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
