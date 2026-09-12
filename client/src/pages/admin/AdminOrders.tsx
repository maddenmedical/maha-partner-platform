import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Order, OrderItem } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Truck, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { COUNTRIES, isEuCountry } from "@shared/schema";

type OrderWithDetails = Order & { partnerName?: string; partnerEmail?: string; items: OrderItem[] };

const STATUS_OPTIONS = ["Requested", "Confirmed", "Fulfilled", "Cancelled"];

function formatPrice(cents: number) {
  return `€${(cents / 100).toFixed(2)}`;
}

function countryName(code?: string | null) {
  if (!code) return null;
  return COUNTRIES.find((c) => c.code === code)?.name || code;
}

export default function AdminOrders() {
  const queryClient = useQueryClient();
  const { data: orders, isLoading } = useQuery<OrderWithDetails[]>({ queryKey: ["/api/admin/orders"] });

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/admin/orders/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/orders"] }),
  });

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <p className="text-sm text-muted-foreground">All order requests from partner clinics.</p>

      {isLoading ? (
        <Skeleton className="h-64 rounded-lg skeleton-shimmer" />
      ) : !orders || orders.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="No orders yet" description="Order requests from partners will appear here." />
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((o) => (
            <Card key={o.id} data-testid={`card-order-${o.id}`} className={cn(o.status === "Requested" && "bg-chart-4/5")}>
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-medium flex items-center gap-2">
                      {o.status === "Requested" && <span className="h-2 w-2 rounded-full bg-primary shrink-0" data-testid={`indicator-unread-order-${o.id}`} />}
                      Order #{o.id} · {o.partnerName}
                    </p>
                    <p className="text-xs text-muted-foreground">{o.partnerEmail} · {format(new Date(o.createdAt), "MMM d, yyyy")}</p>
                  </div>
                  <Select value={o.status} onValueChange={(v) => mutation.mutate({ id: o.id, status: v })}>
                    <SelectTrigger className="w-36 h-8" data-testid={`select-order-status-${o.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="border-t border-border pt-3 flex flex-col gap-1.5">
                  {o.items.map((it) => (
                    <div key={it.id} className="flex justify-between text-sm tabular-nums">
                      <span className="text-muted-foreground">Product #{it.productId} × {it.quantity}</span>
                      <span>{formatPrice(it.unitPriceAtOrder * it.quantity)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm tabular-nums text-muted-foreground">
                    <span>Items subtotal</span>
                    <span>{formatPrice(o.items.reduce((s, it) => s + it.unitPriceAtOrder * it.quantity, 0))}</span>
                  </div>
                  {o.estimatedShippingCost != null && (
                    <div className="flex justify-between text-sm tabular-nums text-muted-foreground" data-testid={`text-order-shipping-${o.id}`}>
                      <span className="flex items-center gap-1.5"><Truck className="h-3.5 w-3.5" /> Estimated shipping (approximate)</span>
                      <span>{formatPrice(o.estimatedShippingCost)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-semibold tabular-nums pt-1.5 border-t border-border">
                    <span>Total</span>
                    <span>{formatPrice(o.items.reduce((s, it) => s + it.unitPriceAtOrder * it.quantity, 0) + (o.estimatedShippingCost ?? 0))}</span>
                  </div>
                  {o.destinationCountry && (
                    <div className="flex items-center justify-between gap-2 pt-1.5" data-testid={`text-order-destination-${o.id}`}>
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Globe className="h-3.5 w-3.5" /> {countryName(o.destinationCountry)} ({o.destinationCountry})
                      </span>
                      <Badge variant={isEuCountry(o.destinationCountry) ? "outline" : "secondary"} className="no-default-hover-elevate no-default-active-elevate">
                        {isEuCountry(o.destinationCountry) ? "EU" : "Non-EU"}
                      </Badge>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
