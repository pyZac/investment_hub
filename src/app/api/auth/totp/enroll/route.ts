import { NextResponse } from "next/server";
import { z } from "zod";
import { beginTotpEnrollment } from "@/lib/totp-enrollment";

const bodySchema = z.object({ pendingToken: z.string().min(1) });

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const { secret, otpauthUri, pendingToken } = await beginTotpEnrollment(
      parsed.data.pendingToken,
      new Date(),
    );
    return NextResponse.json({ secret, otpauthUri, pendingToken });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Enrollment failed.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
