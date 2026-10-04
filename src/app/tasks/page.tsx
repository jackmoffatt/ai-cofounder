import { TasksPage } from "@/components/work/TasksPage";
import { getDb } from "@/db/client";
import { workOverview } from "@/services/work/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks · AI Co-Founder" };

export default function Page() {
  return <TasksPage initial={workOverview(getDb())} />;
}
