import { z } from "zod";

export const adminRecordKinds = ["order", "todo", "announcement", "module", "cohort", "class-session",
  "enrollment", "homework", "admin-account", "price-tier", "course-purchase"] as const;
export type AdminRecordKind = typeof adminRecordKinds[number];
const name = z.string().trim().min(1).max(200);
const id = z.number().int().positive();
const url = z.string().url().refine((v) => /^https?:\/\//i.test(v), "Use an http or https URL");
export const adminRecordEditSchemas = {
  todo: z.object({ status: z.enum(["open", "done"]), assignedToAdminId: id, note: z.string().trim().min(1).max(5000).optional() }).strict(),
  announcement: z.object({ title: name, body: z.string().trim().min(1).max(10000), url: url.or(z.literal("")).nullable() }).strict(),
  module: z.object({ name, description: z.string().max(10000).nullable() }).strict(),
  cohort: z.object({ name, moduleId: id }).strict(),
  "class-session": z.object({ title: name, cohortId: id, datetime: z.number().int().positive(), zoomLink: url, notes: z.string().max(10000).nullable() }).strict(),
  enrollment: z.object({ cohortId: id }).strict(),
  "admin-account": z.object({ archived: z.boolean() }).strict(),
  "price-tier": z.object({ minQty: z.number().int().min(1), maxQty: z.number().int().min(1).nullable(), pricePerUnit: z.number().int().min(0) })
    .strict().refine((v) => v.maxQty === null || v.maxQty >= v.minQty, "Maximum quantity must be at least the minimum"),
};
export type AdminRecordPreview = {
  label: string;
  impact: string;
  canEdit: boolean;
  canEditText: boolean;
  canDelete: boolean;
  blockedReason?: string;
  values: Record<string, string | number | boolean | null>;
};
