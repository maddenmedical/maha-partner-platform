// Thin CLI wrapper. See server/migrateLegacyReferrals.ts for the actual logic
// (shared with the admin-only POST /api/admin/migrate-legacy-referrals route,
// which is how this is run against the live production database).
//
// Run with:  npx tsx server/scripts/importLegacyReferrals.ts
import "dotenv/config";
import { runLegacyReferralImport } from "../migrateLegacyReferrals";

runLegacyReferralImport()
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
