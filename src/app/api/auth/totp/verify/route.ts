import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyTotpAndCreateSession } from "@/lib/auth";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session";
import { requestIp } from "@/lib/request-ip";

const bodySchema = z.object({
  pendingToken: z.string().min(1),
  code: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const { user, token, expiresAt } = await verifyTotpAndCreateSession(
      parsed.data.pendingToken,
      parsed.data.code,
      new Date(),
      requestIp(request),
    );

    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      ...sessionCookieOptions,
      expires: expiresAt,
    });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid authentication code.";
    const isLockout = /locked|too many attempts/i.test(message);
    return NextResponse.json({ error: message }, { status: isLockout ? 429 : 401 });
  }
}
