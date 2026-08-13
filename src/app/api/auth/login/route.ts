import { NextResponse } from "next/server";
import { z } from "zod";
import { login } from "@/lib/auth";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session";
import { requestIp } from "@/lib/request-ip";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = z.object({ email: z.email(), password: z.string().min(1) }).safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const result = await login(parsed.data, new Date(), requestIp(request));

    if (result.status === "totp_required" || result.status === "totp_enrollment_required") {
      return NextResponse.json({ status: result.status, pendingToken: result.pendingToken });
    }

    const response = NextResponse.json({ status: "authenticated", user: result.user });
    response.cookies.set(SESSION_COOKIE_NAME, result.token, {
      ...sessionCookieOptions,
      expires: result.expiresAt,
    });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid email or password.";
    const isLockout = /locked|too many attempts/i.test(message);
    return NextResponse.json({ error: message }, { status: isLockout ? 429 : 401 });
  }
}
