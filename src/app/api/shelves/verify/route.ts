import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type VerifyBody = {
  password?: string;
};

function isPasswordMatch(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  const configuredPassword = process.env.SHELF_EDIT_PASSWORD?.trim();

  if (!configuredPassword) {
    return NextResponse.json(
      { error: "Shelf password is not configured on the server." },
      { status: 500 },
    );
  }

  let body: VerifyBody;

  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const providedPassword = body.password?.trim() ?? "";

  if (!providedPassword) {
    return NextResponse.json(
      { error: "Password is required." },
      { status: 400 },
    );
  }

  if (!isPasswordMatch(providedPassword, configuredPassword)) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
