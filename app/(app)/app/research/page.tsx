import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdminSessionFromHeaders } from "@/lib/auth";
import { ResearchWorkspace } from "@/components/research/ResearchWorkspace";
export default async function ResearchPage() {
  if (!(await requireAdminSessionFromHeaders(await headers())))
    redirect("/app");
  return <ResearchWorkspace />;
}
