import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, AuthError } from "@/lib/route-guard";
import { changePassword } from "@/lib/auth";

export async function POST(request: Request) {
  const now = new Date();
  let user;
  try {
    user = await requireSession(now);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const body = await request.json();
  const parsed = z
    .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) })
    .safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    await changePassword(user.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
