import { NextResponse } from "next/server";
import { getBookById } from "@/lib/hardcover";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const book = await getBookById(id);

    if (!book) {
      return NextResponse.json({ error: "Book not found." }, { status: 404 });
    }

    return NextResponse.json({ book });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load book details.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
