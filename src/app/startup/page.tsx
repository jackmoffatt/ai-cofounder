import { StartupPage } from "@/components/startup/StartupPage";
import { getDb } from "@/db/client";
import { readFounder } from "@/services/memory/founder";
import { readActiveStartup } from "@/services/memory/startup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Startup · AI Co-Founder" };

export default function Page() {
  const db = getDb();
  return <StartupPage initialFounder={readFounder(db)} initialStartup={readActiveStartup(db)} />;
}
