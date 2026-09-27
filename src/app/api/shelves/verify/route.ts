import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type VerifyBody = {
  password?: string;
};

const SHELF_PASSWORD_ENV_KEYS = [
  "SHELF_EDIT_PASSWORD",
  "SHELF_PASSWORD",
  "SHELVES_PASSWORD",
] as const;

function getConfiguredPassword() {
  for (const key of SHELF_PASSWORD_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function isPasswordMatch(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  const configuredPassword = getConfiguredPassword();

  if (!configuredPassword) {
    return NextResponse.json(
      {
        error:
          "Shelf password is not configured on the server. Set SHELF_EDIT_PASSWORD and restart the server.",
      },
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
