import { SettingsPage } from "@/components/settings/SettingsPage";
import { getDb } from "@/db/client";
import { healthReport } from "@/services/health";
import { listTrash } from "@/services/trash";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · AI Co-Founder" };

export default function Page() {
  const db = getDb();
  return <SettingsPage initialHealth={healthReport(db)} initialTrash={listTrash(db)} />;
}
