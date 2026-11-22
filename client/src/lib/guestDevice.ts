// Locators only. No credential, chat text, name, email or pairing code is
// persisted here. The server checks the invitation-specific HttpOnly cookie.
const key="maha-recent-guest-chats";
type Recent={id:string;at:number};
export function recentGuests():Recent[]{
  try{const rows=JSON.parse(localStorage.getItem(key)||"[]");return Array.isArray(rows)?rows.filter(r=>r&&typeof r.id==="string"&&/^[a-f0-9-]{36}$/.test(r.id)&&Number.isFinite(r.at)).slice(0,8):[];}catch{return [];}
}
export function rememberGuest(id:string){try{localStorage.setItem(key,JSON.stringify([{id,at:Date.now()},...recentGuests().filter(r=>r.id!==id)].slice(0,8)));}catch{}}
export function forgetGuest(id:string){try{localStorage.setItem(key,JSON.stringify(recentGuests().filter(r=>r.id!==id)));}catch{}}
