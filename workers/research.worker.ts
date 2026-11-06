import { db } from "@/lib/db";
import { startResearchWorker } from "@/lib/research/worker";

const abort = new AbortController();
const stop = () => abort.abort();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log(
  "Chugao research worker started (global slots: research 1, intake 1).",
);
async function main() {
  try {
    await startResearchWorker(abort.signal);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    // startResearchWorker has already awaited both active tasks and maintenance.
    await db.$disconnect();
  }
}
void main().catch((error) => {
  console.error(
    "Research worker stopped:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exitCode = 1;
});
