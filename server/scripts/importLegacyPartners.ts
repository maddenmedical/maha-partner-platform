// Thin CLI wrapper. See server/migrateLegacyPartners.ts for the actual logic
// (shared with the admin-only POST /api/admin/migrate-legacy-partners route,
// which is how this is run against the live production database).
//
// Run with:  npx tsx server/scripts/importLegacyPartners.ts
import "dotenv/config";
import { runLegacyPartnerImport } from "../migrateLegacyPartners";

runLegacyPartnerImport()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
