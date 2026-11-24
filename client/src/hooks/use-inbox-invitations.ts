import {useQuery} from "@tanstack/react-query";
import {useAuth} from "@/context/AuthContext";
import {apiRequest} from "@/lib/queryClient";
export type InboxInvitation={id:string;label:string;lastMessageAt:number;unread:boolean};
export function useInboxInvitations(){
  const {user}=useAuth();
  return useQuery<InboxInvitation[]>({
    queryKey:["/api/admin/chat/inbox-invitations",user?.id],
    queryFn:async()=>(await apiRequest("GET","/api/admin/chat/inbox-invitations")).json(),
    enabled:user?.role==="admin"&&!user.impersonating,refetchInterval:5000,refetchOnMount:"always",
  });
}
