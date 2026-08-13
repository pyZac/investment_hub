import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmTotpEnrollment } from "@/lib/totp-enrollment";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session";

const bodySchema = z.object({
  pendingToken: z.string().min(1),
  secret: z.string().min(1),
  code: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const { user, token, expiresAt } = await confirmTotpEnrollment(
      parsed.data.pendingToken,
      parsed.data.secret,
      parsed.data.code,
      new Date(),
    );

    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      ...sessionCookieOptions,
      expires: expiresAt,
    });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Enrollment failed.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
