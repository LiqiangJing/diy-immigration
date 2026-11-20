import { clearCookie, logout } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  logout(req);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearCookie() } });
}
