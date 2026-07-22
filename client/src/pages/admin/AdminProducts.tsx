import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Product, PriceTier } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Package, Plus, Trash2, Pencil, Loader2 } from "lucide-react";

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

function formatPrice(cents: number) {
  return `€${(cents / 100).toFixed(2)}`;
}

export default function AdminProducts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: products, isLoading } = useQuery<ProductWithTiers[]>({ queryKey: ["/api/products"] });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductWithTiers | null>(null);
  const [form, setForm] = useState({ name: "", description: "", unitPrice: "", weightGrams: "" });
  const [tierRows, setTierRows] = useState<{ minQty: string; maxQty: string; pricePerUnit: string }[]>([]);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", description: "", unitPrice: "", weightGrams: "300" });
    setTierRows([]);
    setDialogOpen(true);
  }

  function openEdit(p: ProductWithTiers) {
    setEditing(p);
    setForm({ name: p.name, description: p.description, unitPrice: (p.unitPrice / 100).toString(), weightGrams: String(p.weightGrams ?? 300) });
    setTierRows(p.tiers.map((t) => ({ minQty: String(t.minQty), maxQty: t.maxQty ? String(t.maxQty) : "", pricePerUnit: (t.pricePerUnit / 100).toString() })));
    setDialogOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        description: form.description,
        imageUrl: editing?.imageUrl ?? null,
        unitPrice: Math.round(parseFloat(form.unitPrice) * 100),
        active: true,
        weightGrams: form.weightGrams ? Math.round(parseFloat(form.weightGrams)) : 300,
      };
      let productId: number;
      if (editing) {
        await apiRequest("PATCH", `/api/admin/products/${editing.id}`, payload);
        productId = editing.id;
        for (const t of editing.tiers) {
          await apiRequest("DELETE", `/api/admin/tiers/${t.id}`);
        }
      } else {
        const res = await apiRequest("POST", "/api/admin/products", payload);
        const created = await res.json();
        productId = created.id;
      }
      for (const row of tierRows) {
        if (!row.minQty || !row.pricePerUnit) continue;
        await apiRequest("POST", `/api/admin/products/${productId}/tiers`, {
          minQty: Number(row.minQty),
          maxQty: row.maxQty ? Number(row.maxQty) : null,
          pricePerUnit: Math.round(parseFloat(row.pricePerUnit) * 100),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setDialogOpen(false);
      toast({ title: editing ? "Product updated" : "Product created" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Product deleted" });
    },
  });

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage the B2B shop catalog and quantity price tiers.</p>
        <Button size="sm" onClick={openCreate} data-testid="button-add-product">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add product
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-lg skeleton-shimmer" />
      ) : !products || products.length === 0 ? (
        <EmptyState icon={Package} title="No products yet" description="Add your first product to the catalog." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {products.map((p) => (
            <Card key={p.id} data-testid={`card-admin-product-${p.id}`}>
              <CardContent className="p-4 flex flex-col gap-2">
                <div className="aspect-[4/3] rounded-md bg-muted flex items-center justify-center overflow-hidden">
                  {PRODUCT_IMAGES[p.name] ? (
                    <img src={PRODUCT_IMAGES[p.name]} alt={p.name} className="w-full h-full object-contain" data-testid={`img-admin-product-${p.id}`} />
                  ) : (
                    <Package className="h-8 w-8 text-muted-foreground/50" />
                  )}
                </div>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-snug">{p.name}</p>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(p)} data-testid={`button-edit-product-${p.id}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(p.id)} data-testid={`button-delete-product-${p.id}`}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
                <p className="text-sm font-semibold tabular-nums">{formatPrice(p.unitPrice)}</p>
                {p.tiers.length > 0 && (
                  <div className="text-xs text-muted-foreground border-t border-border pt-2">
                    {p.tiers.length} price tier{p.tiers.length !== 1 ? "s" : ""}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto" data-testid="dialog-product-form">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit product" : "Add product"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-product-name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-desc">Description</Label>
              <Textarea id="p-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="textarea-product-description" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-price">Unit price (EUR)</Label>
              <Input id="p-price" type="number" step="0.01" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} data-testid="input-product-price" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-weight">Weight per unit (grams, approximate — used for shipping estimate)</Label>
              <Input id="p-weight" type="number" step="1" value={form.weightGrams} onChange={(e) => setForm({ ...form, weightGrams: e.target.value })} data-testid="input-product-weight" />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Quantity price tiers</Label>
                <Button size="sm" variant="outline" onClick={() => setTierRows([...tierRows, { minQty: "", maxQty: "", pricePerUnit: "" }])} data-testid="button-add-tier">
                  <Plus className="h-3 w-3 mr-1" /> Add tier
                </Button>
              </div>
              {tierRows.map((row, i) => (
                <div key={i} className="grid grid-cols-4 gap-2 items-end">
                  <Input placeholder="Min qty" type="number" value={row.minQty} onChange={(e) => setTierRows(tierRows.map((r, j) => (j === i ? { ...r, minQty: e.target.value } : r)))} data-testid={`input-tier-min-${i}`} />
                  <Input placeholder="Max qty (blank=∞)" type="number" value={row.maxQty} onChange={(e) => setTierRows(tierRows.map((r, j) => (j === i ? { ...r, maxQty: e.target.value } : r)))} data-testid={`input-tier-max-${i}`} />
                  <Input placeholder="Price/unit" type="number" step="0.01" value={row.pricePerUnit} onChange={(e) => setTierRows(tierRows.map((r, j) => (j === i ? { ...r, pricePerUnit: e.target.value } : r)))} data-testid={`input-tier-price-${i}`} />
                  <Button size="icon" variant="ghost" onClick={() => setTierRows(tierRows.filter((_, j) => j !== i))} data-testid={`button-remove-tier-${i}`}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-product">
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
