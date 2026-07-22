import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Product, PriceTier, Order, OrderItem } from "@shared/schema";
import { estimateShippingCostCents, isEuCountry, COUNTRIES } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { CountrySelect } from "@/components/CountrySelect";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { ShoppingCart, Plus, Minus, Trash2, Package, Loader2, Truck, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

// Real product photography sourced from the client's live shop
// (https://partner.maha.clinic/maha-shop-maha/), mapped by product name.
import imgStarterPack from "@/assets/products/maha-essentials-starter-pack.png";
import imgOmniEmFerment from "@/assets/products/omni-em-ferment.png";
import imgEntralisol from "@/assets/products/entralisol.png";
import imgDetoxarcanum from "@/assets/products/detoxarcanum.png";
import imgImunonovum from "@/assets/products/imunonovum.png";
import imgLiposomal from "@/assets/products/liposomal-kurkumin-resveratrol.png";
import imgMaha40 from "@/assets/products/maha-40.png";
import imgMineralCare from "@/assets/products/maha-mineral-care.png";
import imgClarifiedGhee from "@/assets/products/clarified-ghee.png";
import imgShatavariGhee from "@/assets/products/shatavari-ghee.png";
import imgTriphalaGhee from "@/assets/products/triphala-ghee.png";
import imgBrahmiGhee from "@/assets/products/brahmi-ghee.png";

const PRODUCT_IMAGES: Record<string, string> = {
  "MAHA Essentials Starter Pack": imgStarterPack,
  "OMNI EM Ferment": imgOmniEmFerment,
  "Entralisol": imgEntralisol,
  "Detoxarcanum": imgDetoxarcanum,
  "Imunonovum": imgImunonovum,
  "Liposomal Kurkumin & Resveratrol": imgLiposomal,
  "MAHA 40": imgMaha40,
  "MAHA Mineral Care": imgMineralCare,
  "Clarified Ghee": imgClarifiedGhee,
  "Shatavari Ghee": imgShatavariGhee,
  "Triphala Ghee": imgTriphalaGhee,
  "Brahmi Ghee": imgBrahmiGhee,
};

type ProductWithTiers = Product & { tiers: PriceTier[] };
type OrderWithItems = Order & { items: OrderItem[] };

function formatPrice(cents: number) {
  return `€${(cents / 100).toFixed(2)}`;
}

const NON_EU_NOTICE =
  "You are ordering from outside the European Union. Our team will check shipping availability and local import regulations. We will be in touch shortly.";

function unitPriceForQty(product: ProductWithTiers, qty: number) {
  let price = product.unitPrice;
  for (const tier of product.tiers) {
    if (qty >= tier.minQty && (tier.maxQty == null || qty <= tier.maxQty)) {
      price = tier.pricePerUnit;
    }
  }
  return price;
}

export default function Shop() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<Record<number, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [detailProductId, setDetailProductId] = useState<number | null>(null);
  const [destinationCountry, setDestinationCountry] = useState("SI");
  const [lastOrderCountry, setLastOrderCountry] = useState<string | null>(null);

  const { data: products, isLoading } = useQuery<ProductWithTiers[]>({ queryKey: ["/api/products"] });
  const { data: orders, isLoading: ordersLoading } = useQuery<OrderWithItems[]>({ queryKey: ["/api/orders/mine"] });

  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);

  const cartTotal = useMemo(() => {
    if (!products) return 0;
    return Object.entries(cart).reduce((sum, [pid, qty]) => {
      const product = products.find((p) => p.id === Number(pid));
      if (!product) return sum;
      return sum + unitPriceForQty(product, qty) * qty;
    }, 0);
  }, [cart, products]);

  const totalWeightGrams = useMemo(() => {
    if (!products) return 0;
    return Object.entries(cart).reduce((sum, [pid, qty]) => {
      const product = products.find((p) => p.id === Number(pid));
      if (!product) return sum;
      return sum + (product.weightGrams || 0) * qty;
    }, 0);
  }, [cart, products]);

  const estimatedShipping = useMemo(
    () => estimateShippingCostCents(totalWeightGrams, destinationCountry),
    [totalWeightGrams, destinationCountry]
  );
  const destinationIsEu = isEuCountry(destinationCountry);
  const grandTotal = cartTotal + estimatedShipping;

  function updateQty(productId: number, delta: number) {
    setCart((prev) => {
      const next = { ...prev };
      const qty = (next[productId] || 0) + delta;
      if (qty <= 0) delete next[productId];
      else next[productId] = qty;
      return next;
    });
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      const items = Object.entries(cart).map(([productId, quantity]) => ({ productId: Number(productId), quantity }));
      return apiRequest("POST", "/api/orders", { items, destinationCountry });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/home-summary"] });
      setLastOrderCountry(destinationCountry);
      setCart({});
      setCartOpen(false);
      toast({ title: "Order request submitted", description: "The MAHA team will confirm your order shortly." });
    },
    onError: (err: any) => {
      toast({ title: "Could not submit order", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="max-w-2xl mx-auto p-4 flex flex-col gap-6 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">B2B Shop</h1>
          <p className="text-sm text-muted-foreground mt-1">Wholesale pricing for licensed partners. No payment — order requests only.</p>
        </div>
      </div>

      {lastOrderCountry && !isEuCountry(lastOrderCountry) && (
        <div
          className="flex items-start gap-3 rounded-lg border border-card-border bg-secondary p-4"
          data-testid="banner-non-eu-notice"
        >
          <AlertTriangle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Order submitted — outside the EU</p>
            <p className="text-sm text-muted-foreground">{NON_EU_NOTICE}</p>
          </div>
        </div>
      )}

      <Tabs defaultValue="catalog">
        <TabsList>
          <TabsTrigger value="catalog" data-testid="tab-catalog">Catalog</TabsTrigger>
          <TabsTrigger value="orders" data-testid="tab-order-history">Order history</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="mt-4">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-lg skeleton-shimmer" />
              ))}
            </div>
          ) : !products || products.length === 0 ? (
            <EmptyState icon={Package} title="No products yet" description="Check back soon for MAHA's wholesale catalog." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {products.map((p) => {
                const qty = cart[p.id] || 0;
                const activeTierPrice = qty > 0 ? unitPriceForQty(p, qty) : p.unitPrice;
                return (
                  <Card key={p.id} data-testid={`card-product-${p.id}`}>
                    <CardContent className="p-4 flex flex-col gap-2">
                      <button
                        type="button"
                        className="flex flex-col gap-2 text-left rounded-md hover-elevate active-elevate-2 -m-1 p-1"
                        onClick={() => setDetailProductId(p.id)}
                        data-testid={`button-product-detail-${p.id}`}
                      >
                        <div className="aspect-[4/3] rounded-md bg-muted flex items-center justify-center overflow-hidden">
                          {PRODUCT_IMAGES[p.name] ? (
                            <img
                              src={PRODUCT_IMAGES[p.name]}
                              alt={p.name}
                              className="w-full h-full object-contain"
                              data-testid={`img-product-${p.id}`}
                            />
                          ) : (
                            <Package className="h-8 w-8 text-muted-foreground/50" data-testid={`img-placeholder-${p.id}`} />
                          )}
                        </div>
                        <p className="text-sm font-medium leading-snug" data-testid={`text-product-name-${p.id}`}>{p.name}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
                      </button>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-base font-semibold tabular-nums" data-testid={`text-product-price-${p.id}`}>
                          {formatPrice(activeTierPrice)}
                        </span>
                        {p.tiers.length > 0 && (
                          <Badge variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate">
                            Tiered pricing
                          </Badge>
                        )}
                      </div>
                      {p.tiers.length > 0 && (
                        <div className="text-xs text-muted-foreground border-t border-border pt-2 mt-1 flex flex-col gap-0.5">
                          {p.tiers.map((t) => (
                            <div key={t.id} className="flex justify-between tabular-nums">
                              <span>{t.minQty}{t.maxQty ? `–${t.maxQty}` : "+"} units</span>
                              <span>{formatPrice(t.pricePerUnit)}/u</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        {qty === 0 ? (
                          <Button size="sm" onClick={() => updateQty(p.id, 1)} data-testid={`button-add-to-cart-${p.id}`}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add
                          </Button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Button size="icon" variant="outline" onClick={() => updateQty(p.id, -1)} data-testid={`button-decrease-qty-${p.id}`}>
                              <Minus className="h-3.5 w-3.5" />
                            </Button>
                            <span className="w-6 text-center text-sm tabular-nums" data-testid={`text-qty-${p.id}`}>{qty}</span>
                            <Button size="icon" variant="outline" onClick={() => updateQty(p.id, 1)} data-testid={`button-increase-qty-${p.id}`}>
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="orders" className="mt-4">
          {ordersLoading ? (
            <Skeleton className="h-24 rounded-lg skeleton-shimmer" />
          ) : !orders || orders.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="No order requests yet" description="Add products to your cart and submit a request to see it here." />
          ) : (
            <div className="flex flex-col gap-2">
              {orders.map((o) => (
                <Card key={o.id} data-testid={`card-order-${o.id}`}>
                  <CardContent className="p-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Order #{o.id}</span>
                      <StatusBadge status={o.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">{format(new Date(o.createdAt), "MMM d, yyyy")} · {o.items.length} item{o.items.length !== 1 ? "s" : ""}</p>
                    <div className="flex flex-col gap-0.5">
                      <p className="text-sm tabular-nums text-muted-foreground">
                        Items: {formatPrice(o.items.reduce((sum, it) => sum + it.unitPriceAtOrder * it.quantity, 0))}
                      </p>
                      {o.estimatedShippingCost != null && (
                        <p className="text-xs tabular-nums text-muted-foreground flex items-center gap-1.5" data-testid={`text-order-history-shipping-${o.id}`}>
                          <Truck className="h-3 w-3" /> Estimated shipping (approximate): {formatPrice(o.estimatedShippingCost)}
                        </p>
                      )}
                      <p className="text-sm font-semibold tabular-nums">
                        Total: {formatPrice(o.items.reduce((sum, it) => sum + it.unitPriceAtOrder * it.quantity, 0) + (o.estimatedShippingCost ?? 0))}
                      </p>
                    </div>
                    {o.destinationCountry && !isEuCountry(o.destinationCountry) && (
                      <div className="flex items-start gap-2 rounded-md bg-secondary p-2.5 mt-1" data-testid={`banner-order-non-eu-${o.id}`}>
                        <AlertTriangle className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground">{NON_EU_NOTICE}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {cartCount > 0 && (
        <div className="fixed bottom-24 md:bottom-24 left-0 right-0 z-20 flex justify-center px-4 pointer-events-none">
          <Button
            className="shadow-lg max-w-sm w-full pointer-events-auto"
            size="lg"
            onClick={() => setCartOpen(true)}
            data-testid="button-open-cart"
          >
            <ShoppingCart className="h-4 w-4 mr-2" />
            View cart ({cartCount}) · {formatPrice(cartTotal)}
          </Button>
        </div>
      )}

      <ProductDetailSheet
        product={products?.find((p) => p.id === detailProductId) ?? null}
        qty={detailProductId != null ? cart[detailProductId] || 0 : 0}
        onClose={() => setDetailProductId(null)}
        onAdd={(id) => updateQty(id, 1)}
        onIncrease={(id) => updateQty(id, 1)}
        onDecrease={(id) => updateQty(id, -1)}
      />

      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto rounded-t-xl">
          <SheetHeader>
            <SheetTitle>Your cart</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-3 py-4">
            {Object.entries(cart).map(([pid, qty]) => {
              const product = products?.find((p) => p.id === Number(pid));
              if (!product) return null;
              const unitPrice = unitPriceForQty(product, qty);
              return (
                <div key={pid} className="flex items-center justify-between gap-3" data-testid={`row-cart-item-${pid}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{product.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">{qty} × {formatPrice(unitPrice)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-medium tabular-nums">{formatPrice(unitPrice * qty)}</span>
                    <Button size="icon" variant="ghost" onClick={() => setCart((c) => { const n = { ...c }; delete n[Number(pid)]; return n; })} data-testid={`button-remove-cart-item-${pid}`}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <Label htmlFor="destination-country">Destination country</Label>
            <CountrySelect value={destinationCountry} onChange={setDestinationCountry} testId="select-destination-country" />
          </div>

          {!destinationIsEu && (
            <div className="flex items-start gap-2 rounded-md bg-secondary p-3 mt-3" data-testid="banner-checkout-non-eu-notice">
              <AlertTriangle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">{NON_EU_NOTICE}</p>
            </div>
          )}

          <SheetFooter className="flex-col gap-3 sm:flex-col">
            <div className="flex flex-col gap-1.5 w-full pt-2">
              <div className="flex items-center justify-between w-full text-sm text-muted-foreground tabular-nums">
                <span>Items subtotal</span>
                <span>{formatPrice(cartTotal)}</span>
              </div>
              <div className="flex items-center justify-between w-full text-sm text-muted-foreground tabular-nums" data-testid="text-estimated-shipping">
                <span className="flex items-center gap-1.5"><Truck className="h-3.5 w-3.5" /> Estimated shipping (approximate)</span>
                <span>{formatPrice(estimatedShipping)}</span>
              </div>
              <div className="flex items-center justify-between w-full text-base font-semibold tabular-nums border-t border-border pt-1.5 mt-0.5">
                <span>Total</span>
                <span data-testid="text-cart-total">{formatPrice(grandTotal)}</span>
              </div>
            </div>
            <Button
              className="w-full"
              disabled={submitMutation.isPending}
              onClick={() => submitMutation.mutate()}
              data-testid="button-submit-order"
            >
              {submitMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Submit order request
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ProductDetailSheet({
  product, qty, onClose, onAdd, onIncrease, onDecrease,
}: {
  product: ProductWithTiers | null;
  qty: number;
  onClose: () => void;
  onAdd: (id: number) => void;
  onIncrease: (id: number) => void;
  onDecrease: (id: number) => void;
}) {
  const currentUnitPrice = product ? (qty > 0 ? unitPriceForQty(product, qty) : product.unitPrice) : 0;
  return (
    <Sheet open={product != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl">
        {product && (
          <>
            <SheetHeader>
              <SheetTitle data-testid="text-detail-name">{product.name}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-4 py-4">
              <div className="aspect-[4/3] max-h-56 rounded-md bg-muted flex items-center justify-center overflow-hidden">
                {PRODUCT_IMAGES[product.name] ? (
                  <img src={PRODUCT_IMAGES[product.name]} alt={product.name} className="w-full h-full object-contain" data-testid="img-detail" />
                ) : (
                  <Package className="h-10 w-10 text-muted-foreground/50" />
                )}
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-detail-description">{product.description}</p>

              {product.packageSize && (
                <div className="text-sm" data-testid="text-detail-package-size">
                  <span className="font-medium">Package / use: </span>
                  <span className="text-muted-foreground">{product.packageSize}</span>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Pricing (excl. VAT)</h3>
                <div className="rounded-lg border border-border overflow-hidden text-sm">
                  <div className="flex justify-between px-3 py-2 tabular-nums bg-muted/50" data-testid="row-detail-base-price">
                    <span>{product.tiers.length > 0 ? `1–${product.tiers[0].minQty - 1} units` : "Per unit"}</span>
                    <span className="font-medium">{formatPrice(product.unitPrice)}/u</span>
                  </div>
                  {product.tiers.map((t) => (
                    <div key={t.id} className="flex justify-between px-3 py-2 tabular-nums border-t border-border" data-testid={`row-detail-tier-${t.id}`}>
                      <span>{t.minQty}{t.maxQty ? `–${t.maxQty}` : "+"} units</span>
                      <span className="font-medium">{formatPrice(t.pricePerUnit)}/u</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <SheetFooter className="flex-col gap-3 sm:flex-col">
              <div className="flex items-center justify-between w-full">
                <span className="text-lg font-semibold tabular-nums" data-testid="text-detail-current-price">{formatPrice(currentUnitPrice)}/u</span>
                {qty === 0 ? (
                  <Button onClick={() => onAdd(product.id)} data-testid="button-detail-add-to-cart">
                    <Plus className="h-4 w-4 mr-1.5" /> Add to cart
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button size="icon" variant="outline" onClick={() => onDecrease(product.id)} data-testid="button-detail-decrease-qty">
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="w-8 text-center text-sm tabular-nums" data-testid="text-detail-qty">{qty}</span>
                    <Button size="icon" variant="outline" onClick={() => onIncrease(product.id)} data-testid="button-detail-increase-qty">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
