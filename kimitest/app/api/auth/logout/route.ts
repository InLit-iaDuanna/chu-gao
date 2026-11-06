import { ok } from "@/lib/api-response";
import { clearSessionCookie } from "@/lib/session-cookie";

export async function POST() {
  return clearSessionCookie(ok({ loggedOut: true }));
}
