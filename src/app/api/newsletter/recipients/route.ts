import { NextRequest, NextResponse } from "next/server";
import { newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { recipientsWhere } from "@/lib/newsletter/groups";
import { parseGroupIds } from "@/lib/newsletter/rules";

/** Wie viele angemeldete Abonnenten eine Aussendung an diese Gruppen erreicht: ?groups=1,2 (leer: alle). */
export async function GET(request: NextRequest) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const raw = request.nextUrl.searchParams.get("groups") ?? "";
  const ids = parseGroupIds(raw ? raw.split(",") : []);
  if (!ids) return NextResponse.json({ error: "Ungültige Gruppen" }, { status: 400 });
  const count = await auth.db.newsletterSubscriber.count({ where: recipientsWhere(auth.accountId, ids) });
  return NextResponse.json({ count });
}
