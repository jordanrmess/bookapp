"use client";

import "playhtml/dist/style.css";
import { useEffect, useRef, useState } from "react";
import type {
  PlayElementHandle,
  PlayHTMLComponents,
  PresenceView,
} from "playhtml";
import {
  getAnonymousShelfKey,
  getSupabaseClient,
  type ShelfName,
} from "@/lib/supabase";

type BookSuggestion = {
  id: string;
  title: string;
  authors: string;
  slug: string | null;
  coverUrl: string | null;
};

type BookDetails = {
  id: string;
  title: string;
  authors: string;
  coverUrl: string | null;
  pages: number | null;
  releaseYear: number | null;
  description: string | null;
  rating: number | null;
  slug: string | null;
};

type UploadedCsvBook = {
  sourceTitle: string;
  sourceAuthor: string | null;
  book: BookDetails | null;
};

type CsvBookInput = {
  title: string;
  author: string | null;
};

type UploadMatchRow = {
  id: string;
  sourceTitle: string;
  sourceAuthor: string | null;
  candidates: BookSuggestion[];
  recommendedTitles: BookSuggestion[];
  selectedCandidateId: string | null;
};

type UploadRowSearchState = {
  open: boolean;
  query: string;
  loading: boolean;
  results: BookSuggestion[];
  error: string | null;
};

type UploadRowImportState = {
  status: "importing" | "success" | "error";
  message: string;
};

type ShelfKey = "wantToRead" | "currentlyReading" | "booksRead";
const SHELF_ORDER: ShelfKey[] = ["currentlyReading", "wantToRead", "booksRead"];

type ShelfState = {
  books: UploadedCsvBook[];
  loading: boolean;
  error: string | null;
  submittingTitle: string | null;
};

type DraggedShelfBook = {
  sourceShelf: ShelfKey;
  titleKey: string;
};

function getBookDetailsFromRow(
  row: Record<string, unknown>,
): BookDetails | null {
  const title = typeof row.title === "string" ? row.title : null;
  const authors = typeof row.authors === "string" ? row.authors : "";
  const coverUrl = typeof row.cover_url === "string" ? row.cover_url : null;

  if (!title && !coverUrl && !authors) {
    return null;
  }

  return {
    id: typeof row.id === "string" ? row.id : crypto.randomUUID(),
    title:
      title ?? (typeof row.source_title === "string" ? row.source_title : ""),
    authors,
    coverUrl,
    pages: typeof row.pages === "number" ? row.pages : null,
    releaseYear: typeof row.release_year === "number" ? row.release_year : null,
    description: typeof row.description === "string" ? row.description : null,
    rating: typeof row.rating === "number" ? row.rating : null,
    slug: typeof row.slug === "string" ? row.slug : null,
  };
}

function mapUploadedBookToDbRow(shelfId: string, item: UploadedCsvBook) {
  const book = item.book;

  return {
    shelf_id: shelfId,
    source_title: item.sourceTitle,
    source_author: item.sourceAuthor ?? null,
    title: book?.title ?? null,
    authors: book?.authors ?? null,
    cover_url: book?.coverUrl ?? null,
    pages: book?.pages ?? null,
    release_year: book?.releaseYear ?? null,
    description: book?.description ?? null,
    rating: book?.rating ?? null,
    slug: book?.slug ?? null,
  };
}

function mapDbRowToUploadedBook(row: Record<string, unknown>): UploadedCsvBook {
  const sourceTitle =
    typeof row.source_title === "string" ? row.source_title : "Unknown book";
  const sourceAuthor =
    typeof row.source_author === "string" ? row.source_author : null;
  const book = getBookDetailsFromRow(row);

  return {
    sourceTitle,
    sourceAuthor,
    book,
  };
}

const MIN_QUERY_LENGTH = 2;
const UPLOAD_SEARCH_MAX_ATTEMPTS = 3;
const UPLOAD_SEARCH_RETRY_DELAY_MS = 220;
const CURSOR_IMAGE_CHANNEL = "bookCursorImage";
const COVER_CURSOR_CLASS = "book-cover-cursor";
const CURSOR_NAME_CLASS = "book-cursor-name";
const CURSOR_WIDTH = 51;
const CURSOR_HEIGHT = 72;
const CURSOR_BORDER_RADIUS = 9;
const SHELF_BOOK_DRAG_MIME = "application/x-booksrus-shelf-book";
const TOUCH_MOUSE_GUARD_MS = 320;

type CursorIdentity = {
  imageUrl: string | null;
  name: string | null;
};

type CursorImagePresence = {
  imageUrl: string | null;
};

function getImageUrlFromPresence(presence: PresenceView) {
  const channelValue = (presence as Record<string, unknown>)[
    CURSOR_IMAGE_CHANNEL
  ];

  if (channelValue && typeof channelValue === "object") {
    const imageUrl = (channelValue as { imageUrl?: unknown }).imageUrl;
    if (typeof imageUrl === "string" && imageUrl.length > 0) {
      return imageUrl;
    }
  }

  const flatImageUrl = (presence as { imageUrl?: unknown }).imageUrl;
  return typeof flatImageUrl === "string" && flatImageUrl.length > 0
    ? flatImageUrl
    : null;
}

function applyCoverCursor(element: HTMLElement, imageUrl?: string) {
  const existing = element.querySelector(
    `.${COVER_CURSOR_CLASS}`,
  ) as HTMLDivElement | null;
  const icon = element.querySelector("svg");

  if (!imageUrl) {
    existing?.remove();

    if (icon instanceof SVGElement) {
      icon.style.display = "";
    }

    return;
  }

  if (icon instanceof SVGElement) {
    icon.style.display = "none";
  }

  const cover = existing ?? document.createElement("div");
  cover.className = COVER_CURSOR_CLASS;
  cover.style.width = `${CURSOR_WIDTH}px`;
  cover.style.height = `${CURSOR_HEIGHT}px`;
  cover.style.borderRadius = `${CURSOR_BORDER_RADIUS}px`;
  cover.style.border = "1px solid #235848";
  cover.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.2)";
  cover.style.backgroundImage = `url(${imageUrl})`;
  cover.style.backgroundPosition = "center";
  cover.style.backgroundRepeat = "no-repeat";
  cover.style.backgroundSize = "cover";
  cover.style.pointerEvents = "none";

  if (!existing) {
    element.appendChild(cover);
  }
}

function applyCursorName(element: HTMLElement, name?: string | null) {
  const defaultLabel = element.querySelector(".playhtml-cursor-name");
  defaultLabel?.remove();
  const defaultMessage = element.querySelector(".playhtml-cursor-message");
  defaultMessage?.remove();

  const existing = element.querySelector(
    `.${CURSOR_NAME_CLASS}`,
  ) as HTMLDivElement | null;

  if (!name) {
    existing?.remove();
    return;
  }

  const label = existing ?? document.createElement("div");
  label.className = CURSOR_NAME_CLASS;
  label.textContent = `${name} is reading`;
  label.style.position = "absolute";
  label.style.left = "0";
  label.style.top = `${CURSOR_HEIGHT + 6}px`;
  label.style.padding = "4px 8px";
  label.style.fontSize = "12px";
  label.style.lineHeight = "1";
  label.style.borderRadius = "999px";
  label.style.background = "rgba(255, 255, 255, 0.92)";
  label.style.border = "1px solid #235848";
  label.style.color = "#235848";
  label.style.whiteSpace = "nowrap";
  label.style.pointerEvents = "none";

  if (!existing) {
    element.appendChild(label);
  }
}

function parseCsvRows(csvText: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];

    if (char === '"') {
      const nextChar = csvText[index + 1];
      if (inQuotes && nextChar === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      row.push(field.trim());
      field = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && csvText[index + 1] === "\n") {
        index += 1;
      }
      row.push(field.trim());
      field = "";

      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    field += char;
  }

  row.push(field.trim());
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function normalizeMatchValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyAuthorMatch(candidateAuthors: string, expectedAuthor: string) {
  const normalizedCandidate = normalizeMatchValue(candidateAuthors);
  const normalizedExpected = normalizeMatchValue(expectedAuthor);

  if (!normalizedCandidate || !normalizedExpected) {
    return false;
  }

  return (
    normalizedCandidate.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedCandidate)
  );
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function fetchSearchResultsWithRetry(
  query: string,
  source: "automatic_match" | "manual_row_search",
) {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= UPLOAD_SEARCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(
        `/api/search?query=${encodeURIComponent(query)}`,
      );

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        console.warn("[Upload Search] Search request attempt failed", {
          source,
          query,
          attempt,
          maxAttempts: UPLOAD_SEARCH_MAX_ATTEMPTS,
          httpStatus: response.status,
        });
      } else {
        const payload = (await response.json()) as {
          results?: BookSuggestion[];
        };

        if (attempt > 1) {
          console.log("[Upload Search] Search request succeeded after retry", {
            source,
            query,
            attempt,
            maxAttempts: UPLOAD_SEARCH_MAX_ATTEMPTS,
          });
        }

        return {
          results: payload.results ?? [],
          attempt,
        };
      }
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("Unknown search error");
      console.warn("[Upload Search] Search request attempt threw error", {
        source,
        query,
        attempt,
        maxAttempts: UPLOAD_SEARCH_MAX_ATTEMPTS,
        error: lastError.message,
      });
    }

    if (attempt < UPLOAD_SEARCH_MAX_ATTEMPTS) {
      await wait(UPLOAD_SEARCH_RETRY_DELAY_MS * attempt);
    }
  }

  throw (
    lastError ?? new Error("Search request failed after all retry attempts.")
  );
}

function getCsvBookInputsFromCsv(csvText: string) {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) {
    return [];
  }

  const parsedRows = rows
    .map((row) => ({
      title: row[1]?.trim() ?? "",
      author: row[2]?.trim() ?? "",
    }))
    .filter((row) => row.title.length > 0);

  if (parsedRows.length === 0) {
    return [];
  }

  const firstRow = parsedRows[0];
  const firstTitle = firstRow?.title.toLowerCase() ?? "";
  const firstAuthor = firstRow?.author.toLowerCase() ?? "";
  const startsWithHeader =
    firstTitle === "title" ||
    firstTitle === "book" ||
    firstTitle === "book title" ||
    firstAuthor === "author" ||
    firstAuthor === "authors";

  const dataRows = startsWithHeader ? parsedRows.slice(1) : parsedRows;
  const uniqueRows = new Map<string, CsvBookInput>();

  dataRows.forEach((row) => {
    const key = normalizeMatchValue(row.title);
    if (!key) {
      return;
    }

    if (!uniqueRows.has(key)) {
      uniqueRows.set(key, {
        title: row.title,
        author: row.author || null,
      });
    }
  });

  return Array.from(uniqueRows.values());
}

function getBookInputsFromPastedList(rawText: string) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const parsedRows = lines.map((line) => {
    if (line.includes("\t")) {
      const [title, author] = line
        .split("\t")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      return { title: title ?? "", author: author ?? "" };
    }

    if (line.includes(" | ")) {
      const [title, author] = line.split(" | ").map((part) => part.trim());
      return { title: title ?? "", author: author ?? "" };
    }

    if (line.includes(",")) {
      const [title, author] = line.split(",").map((part) => part.trim());
      return { title: title ?? "", author: author ?? "" };
    }

    return { title: line, author: "" };
  });

  const firstRow = parsedRows[0];
  const firstTitle = firstRow?.title.toLowerCase() ?? "";
  const firstAuthor = firstRow?.author.toLowerCase() ?? "";
  const startsWithHeader =
    firstTitle === "title" ||
    firstTitle === "book" ||
    firstTitle === "book title" ||
    firstAuthor === "author" ||
    firstAuthor === "authors";

  const dataRows = startsWithHeader ? parsedRows.slice(1) : parsedRows;
  const uniqueRows = new Map<string, CsvBookInput>();

  dataRows.forEach((row) => {
    const title = row.title.trim();
    const key = normalizeMatchValue(title);
    if (!key) {
      return;
    }

    if (!uniqueRows.has(key)) {
      uniqueRows.set(key, {
        title,
        author: row.author.trim() || null,
      });
    }
  });

  return Array.from(uniqueRows.values());
}

function getUniqueTitleKey(item: UploadedCsvBook) {
  const value = item.book?.title ?? item.sourceTitle;
  return value.trim().toLowerCase();
}

function mergeUniqueShelfBooks(
  current: UploadedCsvBook[],
  incoming: UploadedCsvBook[],
) {
  const seen = new Set(current.map((item) => getUniqueTitleKey(item)));
  const merged = [...current];

  incoming.forEach((item) => {
    const key = getUniqueTitleKey(item);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.push(item);
  });

  return merged;
}

type SupabaseQueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

type SupabaseShelfRow = {
  id: string;
  shelf_name: string;
};

type SupabaseBookInsertRow = {
  shelf_id: string;
  source_title: string;
  source_author: string | null;
  title: string | null;
  authors: string | null;
  cover_url: string | null;
  pages: number | null;
  release_year: number | null;
  description: string | null;
  rating: number | null;
  slug: string | null;
};

type SupabaseTableClient = {
  select: (columns: string) => {
    eq: (
      column: string,
      value: string,
    ) => Promise<SupabaseQueryResult<SupabaseShelfRow[]>>;
    in: (
      column: string,
      values: string[],
    ) => Promise<SupabaseQueryResult<Record<string, unknown>[]>>;
  };
  upsert: (
    rows: Array<{ anonymous_key: string; shelf_name: ShelfName }>,
    options: { onConflict: string },
  ) => {
    select: (columns: string) => {
      single: () => Promise<SupabaseQueryResult<{ id: string }>>;
    };
  };
  delete: () => {
    eq: (column: string, value: string) => Promise<SupabaseQueryResult<null>>;
  };
  insert: (rows: SupabaseBookInsertRow[]) => Promise<SupabaseQueryResult<null>>;
};

function createShelfState(): ShelfState {
  return {
    books: [],
    loading: false,
    error: null,
    submittingTitle: null,
  };
}

function serializeShelfState(shelves: Record<ShelfKey, ShelfState>) {
  return JSON.stringify({
    wantToRead: shelves.wantToRead.books.map((item) => ({
      sourceTitle: item.sourceTitle,
      sourceAuthor: item.sourceAuthor,
      book: item.book,
    })),
    currentlyReading: shelves.currentlyReading.books.map((item) => ({
      sourceTitle: item.sourceTitle,
      sourceAuthor: item.sourceAuthor,
      book: item.book,
    })),
    booksRead: shelves.booksRead.books.map((item) => ({
      sourceTitle: item.sourceTitle,
      sourceAuthor: item.sourceAuthor,
      book: item.book,
    })),
  });
}

async function loadShelfState() {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const anonymousKey = getAnonymousShelfKey();

  const supabaseTables = client as unknown as {
    from: (table: "shelves" | "books") => SupabaseTableClient;
  };

  const response = (await supabaseTables
    .from("shelves")
    .select("id, shelf_name")
    .eq("anonymous_key", anonymousKey)) as SupabaseQueryResult<
    SupabaseShelfRow[]
  >;

  const { data: shelfRows, error: shelfError } = response;

  if (shelfError) {
    throw shelfError;
  }

  const shelfMap = new Map<string, string>();
  for (const row of shelfRows ?? []) {
    const shelfName =
      typeof row.shelf_name === "string" ? row.shelf_name : null;
    const shelfId = typeof row.id === "string" ? row.id : null;

    if (shelfName && shelfId) {
      shelfMap.set(shelfName, shelfId);
    }
  }

  const nextShelves: Record<ShelfKey, ShelfState> = {
    wantToRead: createShelfState(),
    currentlyReading: createShelfState(),
    booksRead: createShelfState(),
  };

  if (shelfMap.size > 0) {
    const bookResponse = (await supabaseTables
      .from("books")
      .select("*")
      .in("shelf_id", Array.from(shelfMap.values()))) as SupabaseQueryResult<
      Record<string, unknown>[]
    >;

    const { data: bookRows, error: bookError } = bookResponse;

    if (bookError) {
      throw bookError;
    }

    const booksByShelf = new Map<string, UploadedCsvBook[]>();

    for (const row of bookRows ?? []) {
      const shelfId = typeof row.shelf_id === "string" ? row.shelf_id : null;
      if (!shelfId) {
        continue;
      }

      const existing = booksByShelf.get(shelfId) ?? [];
      booksByShelf.set(shelfId, [...existing, mapDbRowToUploadedBook(row)]);
    }

    for (const shelfName of SHELF_ORDER) {
      const shelfId = shelfMap.get(shelfName);
      if (!shelfId) {
        continue;
      }

      nextShelves[shelfName] = {
        ...createShelfState(),
        books: booksByShelf.get(shelfId) ?? [],
      };
    }
  }

  return nextShelves;
}

async function saveShelfState(nextShelves: Record<ShelfKey, ShelfState>) {
  const client = getSupabaseClient();
  if (!client) {
    return;
  }

  const anonymousKey = getAnonymousShelfKey();

  const supabaseTables = client as unknown as {
    from: (table: "shelves" | "books") => SupabaseTableClient;
  };

  for (const shelfName of SHELF_ORDER) {
    const shelf = nextShelves[shelfName];
    const shelfPayload = [
      {
        anonymous_key: anonymousKey,
        shelf_name: shelfName as ShelfName,
      },
    ] as Array<{
      anonymous_key: string;
      shelf_name: ShelfName;
    }>;

    const shelfResponse = (await supabaseTables
      .from("shelves")
      .upsert(shelfPayload, {
        onConflict: "anonymous_key,shelf_name",
      })
      .select("id")
      .single()) as SupabaseQueryResult<{ id: string }>;

    const { data: shelfRow, error: shelfError } = shelfResponse;

    if (shelfError) {
      throw shelfError;
    }

    if (!shelfRow?.id) {
      continue;
    }

    const { error: deleteError } = (await client
      .from("books")
      .delete()
      .eq("shelf_id", shelfRow.id)) as {
      error: { message: string } | null;
    };

    if (deleteError) {
      throw deleteError;
    }

    if (shelf.books.length === 0) {
      continue;
    }

    const bookRows = shelf.books.map((item) =>
      mapUploadedBookToDbRow(shelfRow.id, item),
    ) as Array<{
      shelf_id: string;
      source_title: string;
      source_author: string | null;
      title: string | null;
      authors: string | null;
      cover_url: string | null;
      pages: number | null;
      release_year: number | null;
      description: string | null;
      rating: number | null;
      slug: string | null;
    }>;

    const { error: insertError } = (await supabaseTables
      .from("books")
      .insert(bookRows)) as SupabaseQueryResult<null>;

    if (insertError) {
      throw insertError;
    }
  }
}

type SiteColors = {
  background: string;
  text: string;
};

const DEFAULT_SITE_COLORS: SiteColors = {
  background: "#c8ef65",
  text: "#235848",
};
const SITE_COLORS_ELEMENT_ID = "site-colors";
const SITE_COLOR_WRITE_DELAY_MS = 150;

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (light + 0.05) / (dark + 0.05);
}

// A random background plus a text color from the same hue family, nudged
// darker or lighter until the pair stays comfortably readable.
function randomSiteColors(): SiteColors {
  const hue = Math.random() * 360;
  const darkMode = Math.random() < 0.35;
  const background = hslToHex(
    hue,
    0.45 + Math.random() * 0.4,
    darkMode ? 0.12 + Math.random() * 0.1 : 0.72 + Math.random() * 0.18,
  );
  const textHue =
    (hue + (Math.random() < 0.5 ? 0 : 30 + Math.random() * 30)) % 360;
  let lightness = darkMode ? 0.8 : 0.22;
  let text = hslToHex(textHue, 0.5, lightness);
  for (let i = 0; i < 20 && contrastRatio(background, text) < 7; i++) {
    lightness += darkMode ? 0.02 : -0.02;
    text = hslToHex(textHue, 0.5, Math.min(0.98, Math.max(0.02, lightness)));
  }
  return { background, text };
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export default function Home() {
  const [modalOpen, setModalOpen] = useState(false);
  const [colorsModalOpen, setColorsModalOpen] = useState(false);
  const [uploadMatchHidden, setUploadMatchHidden] = useState(false);
  const [bookWindow, setBookWindow] = useState<BookDetails | null>(null);
  const [bookWindowDetails, setBookWindowDetails] =
    useState<BookDetails | null>(null);
  const [bookWindowStatus, setBookWindowStatus] = useState<
    "loading" | "done" | "error"
  >("loading");
  const [nameInput, setNameInput] = useState("");
  const [bookQuery, setBookQuery] = useState("");
  const [bookResults, setBookResults] = useState<BookSuggestion[]>([]);
  const [selectedBook, setSelectedBook] = useState<BookDetails | null>(null);
  const [activeName, setActiveName] = useState<string>("");
  const [activeCursorImage, setActiveCursorImage] = useState<string | null>(
    null,
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [shelves, setShelves] = useState<Record<ShelfKey, ShelfState>>({
    wantToRead: createShelfState(),
    currentlyReading: createShelfState(),
    booksRead: createShelfState(),
  });
  const [addModalShelf, setAddModalShelf] = useState<ShelfKey | null>(null);
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState<BookSuggestion[]>([]);
  const [addSearchLoading, setAddSearchLoading] = useState(false);
  const [addModalError, setAddModalError] = useState<string | null>(null);
  const [addingBookId, setAddingBookId] = useState<string | null>(null);
  const [collapsedShelves, setCollapsedShelves] = useState<
    Record<ShelfKey, boolean>
  >({
    wantToRead: true,
    currentlyReading: true,
    booksRead: true,
  });
  const [editAuthOpen, setEditAuthOpen] = useState(false);
  const [editPassword, setEditPassword] = useState("");
  const [editAuthError, setEditAuthError] = useState<string | null>(null);
  const [editAuthLoading, setEditAuthLoading] = useState(false);
  const [shelvesLoaded, setShelvesLoaded] = useState(false);
  const [draggedShelfBook, setDraggedShelfBook] =
    useState<DraggedShelfBook | null>(null);
  const [activeDropShelf, setActiveDropShelf] = useState<ShelfKey | null>(null);
  const [uploadMatchShelf, setUploadMatchShelf] = useState<ShelfKey | null>(
    null,
  );
  const [uploadMatchRows, setUploadMatchRows] = useState<UploadMatchRow[]>([]);
  const [uploadMatchError, setUploadMatchError] = useState<string | null>(null);
  const [uploadImporting, setUploadImporting] = useState(false);
  const [uploadDuplicateCount, setUploadDuplicateCount] = useState(0);
  const [uploadRowSearchState, setUploadRowSearchState] = useState<
    Record<string, UploadRowSearchState>
  >({});
  const [uploadRowImportState, setUploadRowImportState] = useState<
    Record<string, UploadRowImportState>
  >({});
  const [pasteModalShelf, setPasteModalShelf] = useState<ShelfKey | null>(null);
  const [pasteUploadText, setPasteUploadText] = useState("");
  const [pasteUploadError, setPasteUploadError] = useState<string | null>(null);
  const [siteColors, setSiteColors] = useState<SiteColors>(DEFAULT_SITE_COLORS);
  const siteColorsHandleRef = useRef<PlayElementHandle<SiteColors> | null>(
    null,
  );
  const siteColorWriteTimeoutRef = useRef<number | null>(null);
  const pendingSiteColorsRef = useRef<Partial<SiteColors>>({});
  const lastPersistedShelfSnapshotRef = useRef<string | null>(null);
  const pendingShelfMutationRef = useRef<(() => void | Promise<void>) | null>(
    null,
  );

  const playRef = useRef<PlayHTMLComponents | null>(null);
  const remoteCursorIdentityRef = useRef(new Map<string, CursorIdentity>());
  const remoteCursorElementRef = useRef(new Map<string, HTMLElement>());
  const localCursorElementRef = useRef<HTMLDivElement | null>(null);
  const suppressNextSearchRef = useRef(false);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadShelfRef = useRef<ShelfKey>("booksRead");
  // Drafts kept when a modal is dismissed by clicking outside it. They only
  // live in memory, so they last until the person leaves the page.
  const profileDraftRef = useRef(false);
  const addDraftShelfRef = useRef<ShelfKey | null>(null);
  const pasteDraftShelfRef = useRef<ShelfKey | null>(null);
  const backdropPressedRef = useRef(false);
  const [modalOffsets, setModalOffsets] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const isAnyModalOpen =
    modalOpen ||
    addModalShelf !== null ||
    editAuthOpen ||
    (uploadMatchShelf !== null && !uploadMatchHidden) ||
    pasteModalShelf !== null ||
    bookWindow !== null;
  const displayedUploadRows = uploadMatchRows.filter(
    (row) =>
      row.candidates.length === 0 || Boolean(uploadRowImportState[row.id]),
  );
  const hasAnyRowImporting = Object.values(uploadRowImportState).some(
    (state) => state.status === "importing",
  );

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--site-bg", siteColors.background);
    root.setProperty("--foreground", siteColors.text);
  }, [siteColors]);

  useEffect(() => {
    return () => {
      if (siteColorWriteTimeoutRef.current !== null) {
        window.clearTimeout(siteColorWriteTimeoutRef.current);
      }
    };
  }, []);

  function shuffleSiteColors() {
    const next = randomSiteColors();
    updateSiteColor("background", next.background);
    updateSiteColor("text", next.text);
  }

  function updateSiteColor(key: keyof SiteColors, value: string) {
    // Preview locally right away; the shared write is debounced so dragging
    // through the picker doesn't flood the room with updates. Pending values
    // are tracked per color so changing one never drops the other's write.
    setSiteColors((current) => ({ ...current, [key]: value }));
    pendingSiteColorsRef.current[key] = value;

    if (siteColorWriteTimeoutRef.current !== null) {
      window.clearTimeout(siteColorWriteTimeoutRef.current);
    }
    siteColorWriteTimeoutRef.current = window.setTimeout(() => {
      siteColorWriteTimeoutRef.current = null;
      const pending = pendingSiteColorsRef.current;
      pendingSiteColorsRef.current = {};
      siteColorsHandleRef.current?.setData((draft) => {
        if (pending.background) {
          draft.background = pending.background;
        }
        if (pending.text) {
          draft.text = pending.text;
        }
      });
    }, SITE_COLOR_WRITE_DELAY_MS);
  }

  useEffect(() => {
    const styleId = "playhtml-hide-default-cursor-labels";
    if (document.getElementById(styleId)) {
      return;
    }

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .playhtml-cursor-other .playhtml-cursor-name,
      .playhtml-cursor-other .playhtml-cursor-message {
        display: none !important;
      }
    `;

    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let unsubscribePresence: (() => void) | null = null;

    void (async () => {
      const { playhtml } = await import("playhtml");

      if (!isMounted) {
        return;
      }

      playRef.current = playhtml;

      // Shared across every visitor. `update` only reads shared data into
      // React state; writes happen from the color inputs.
      siteColorsHandleRef.current = playhtml.register<SiteColors>(
        SITE_COLORS_ELEMENT_ID,
        {
          defaultData: DEFAULT_SITE_COLORS,
          update: ({ data }) => {
            setSiteColors({
              background: isHexColor(data?.background)
                ? data.background
                : DEFAULT_SITE_COLORS.background,
              text: isHexColor(data?.text)
                ? data.text
                : DEFAULT_SITE_COLORS.text,
            });
          },
        },
      );

      playhtml.init({
        cursors: {
          enabled: true,
          onCustomCursorRender: (connectionId, element) => {
            remoteCursorElementRef.current.set(connectionId, element);

            queueMicrotask(() => {
              const identity =
                remoteCursorIdentityRef.current.get(connectionId) ?? null;
              applyCoverCursor(element, identity?.imageUrl ?? undefined);
              applyCursorName(element, identity?.name ?? null);
            });

            return null;
          },
        },
      });

      playhtml.presence.setMyPresence(CURSOR_IMAGE_CHANNEL, {
        imageUrl: null,
      } satisfies CursorImagePresence);

      unsubscribePresence = playhtml.presence.onPresenceChange(
        CURSOR_IMAGE_CHANNEL,
        (presences) => {
          const next = new Map(remoteCursorIdentityRef.current);

          presences.forEach((presence: PresenceView, key) => {
            const imageUrl = getImageUrlFromPresence(presence);
            const stableId = presence.playerIdentity?.publicKey;
            const name = presence.playerIdentity?.name ?? null;
            const identity: CursorIdentity = {
              imageUrl,
              name,
            };

            if (imageUrl) {
              next.set(key, identity);
              if (stableId) {
                next.set(stableId, identity);
              }
            } else {
              next.delete(key);
              if (stableId) {
                next.delete(stableId);
              }
            }
          });

          remoteCursorIdentityRef.current = next;

          remoteCursorElementRef.current.forEach((element, connectionId) => {
            const identity = next.get(connectionId) ?? null;
            applyCoverCursor(element, identity?.imageUrl ?? undefined);
            applyCursorName(element, identity?.name ?? null);
          });
        },
      );

      if (!isMounted) {
        unsubscribePresence?.();
      }
    })();

    return () => {
      isMounted = false;
      unsubscribePresence?.();
      siteColorsHandleRef.current?.unregister();
      siteColorsHandleRef.current = null;
      playRef.current = null;
    };
  }, []);

  useEffect(() => {
    playRef.current?.presence.setMyPresence(CURSOR_IMAGE_CHANNEL, {
      imageUrl: activeCursorImage,
    } satisfies CursorImagePresence);
  }, [activeCursorImage]);

  useEffect(() => {
    if (!activeCursorImage) {
      localCursorElementRef.current?.remove();
      localCursorElementRef.current = null;
      return;
    }

    const cursor = document.createElement("div");
    cursor.className = `${COVER_CURSOR_CLASS} local-book-cover-cursor`;
    cursor.style.position = "fixed";
    cursor.style.left = "0";
    cursor.style.top = "0";
    cursor.style.width = `${CURSOR_WIDTH}px`;
    cursor.style.height = `${CURSOR_HEIGHT}px`;
    cursor.style.transform = "translate(-200px, -200px)";
    cursor.style.borderRadius = `${CURSOR_BORDER_RADIUS}px`;
    cursor.style.border = "1px solid #235848";
    cursor.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.2)";
    cursor.style.backgroundImage = `url(${activeCursorImage})`;
    cursor.style.backgroundPosition = "center";
    cursor.style.backgroundRepeat = "no-repeat";
    cursor.style.backgroundSize = "cover";
    cursor.style.pointerEvents = "none";
    cursor.style.zIndex = "2147483647";

    const nameTag = document.createElement("div");
    nameTag.textContent = activeName
      ? `${activeName} is reading`
      : "reader is reading";
    nameTag.style.position = "absolute";
    nameTag.style.left = "0";
    nameTag.style.top = `${CURSOR_HEIGHT + 6}px`;
    nameTag.style.padding = "4px 8px";
    nameTag.style.fontSize = "12px";
    nameTag.style.lineHeight = "1";
    nameTag.style.borderRadius = "999px";
    nameTag.style.background = "rgba(255, 255, 255, 0.92)";
    nameTag.style.border = "1px solid #235848";
    nameTag.style.color = "#235848";
    nameTag.style.whiteSpace = "nowrap";
    nameTag.style.position = "absolute";
    nameTag.style.zIndex = "2147483647";
    cursor.appendChild(nameTag);

    const setCursorPosition = (
      x: number,
      y: number,
      movement: "instant" | "glide",
    ) => {
      cursor.style.transition =
        movement === "glide"
          ? "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)"
          : "none";
      cursor.style.transform = `translate(${x + 10}px, ${y - 8}px)`;
    };

    let lastTouchAt = 0;

    const syncMousePosition = (event: MouseEvent) => {
      if (performance.now() - lastTouchAt < TOUCH_MOUSE_GUARD_MS) {
        return;
      }

      setCursorPosition(event.clientX, event.clientY, "instant");
    };

    const syncTouchPosition = (event: TouchEvent) => {
      const point = event.touches[0] ?? event.changedTouches[0];
      if (!point) {
        return;
      }

      lastTouchAt = performance.now();

      setCursorPosition(point.clientX, point.clientY, "glide");

      // Keep shared cursor listeners in sync on touch-only devices.
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: point.clientX,
          clientY: point.clientY,
          bubbles: true,
        }),
      );
    };

    document.body.appendChild(cursor);
    localCursorElementRef.current = cursor;
    window.addEventListener("mousemove", syncMousePosition);
    window.addEventListener("touchstart", syncTouchPosition, {
      passive: true,
    });
    window.addEventListener("touchmove", syncTouchPosition, {
      passive: true,
    });

    return () => {
      window.removeEventListener("mousemove", syncMousePosition);
      window.removeEventListener("touchstart", syncTouchPosition);
      window.removeEventListener("touchmove", syncTouchPosition);
      cursor.remove();
      if (localCursorElementRef.current === cursor) {
        localCursorElementRef.current = null;
      }
    };
  }, [activeCursorImage, activeName]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const loaded = await loadShelfState();
        if (!active) {
          return;
        }

        if (loaded) {
          const snapshot = serializeShelfState(loaded);
          lastPersistedShelfSnapshotRef.current = snapshot;
          setShelves(loaded);
        }
      } catch (error) {
        console.error("[supabase] failed to load shelves", error);
      } finally {
        if (active) {
          setShelvesLoaded(true);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!shelvesLoaded) {
      return;
    }

    const nextSnapshot = serializeShelfState(shelves);
    if (lastPersistedShelfSnapshotRef.current === nextSnapshot) {
      return;
    }

    const hasAnyBooks = Object.values(shelves).some(
      (shelf) => shelf.books.length > 0,
    );
    if (!hasAnyBooks && lastPersistedShelfSnapshotRef.current === null) {
      return;
    }

    void (async () => {
      try {
        await saveShelfState(shelves);
        lastPersistedShelfSnapshotRef.current = nextSnapshot;
      } catch (error) {
        console.error("[supabase] failed to save shelves", error);
      }
    })();
  }, [shelves, shelvesLoaded]);

  useEffect(() => {
    document.body.classList.toggle("profile-modal-open", isAnyModalOpen);

    return () => {
      document.body.classList.remove("profile-modal-open");
    };
  }, [isAnyModalOpen]);

  useEffect(() => {
    const shouldAllowDrag = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return false;
      }

      return Boolean(
        target.closest(
          '[draggable="true"], input, textarea, button, select, [contenteditable="true"]',
        ),
      );
    };

    const preventBackgroundDrag = (event: DragEvent) => {
      if (shouldAllowDrag(event.target)) {
        return;
      }

      event.preventDefault();
    };

    document.addEventListener("dragstart", preventBackgroundDrag);

    return () => {
      document.removeEventListener("dragstart", preventBackgroundDrag);
    };
  }, []);

  useEffect(() => {
    let touchStartY = 0;
    let touchStartX = 0;

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      touchStartY = touch.clientY;
      touchStartX = touch.clientX;
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      const deltaY = touch.clientY - touchStartY;
      const deltaX = touch.clientX - touchStartX;
      const isVerticalSwipe = Math.abs(deltaY) > Math.abs(deltaX);

      if (window.scrollY <= 0 && deltaY > 0 && isVerticalSwipe) {
        event.preventDefault();
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  useEffect(() => {
    const normalized = bookQuery.trim();
    const controller = new AbortController();

    if (suppressNextSearchRef.current) {
      suppressNextSearchRef.current = false;
      return () => controller.abort();
    }

    if (normalized.length < MIN_QUERY_LENGTH) {
      return () => controller.abort();
    }

    const timeout = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        console.log("[modal/search] submitting query:", normalized);
        const response = await fetch(
          `/api/search?query=${encodeURIComponent(normalized)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error("Unable to search right now.");
        }

        const payload = (await response.json()) as {
          results?: BookSuggestion[];
        };
        setBookResults(payload.results ?? []);
      } catch {
        if (!controller.signal.aborted) {
          setBookResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearchLoading(false);
        }
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [bookQuery]);

  useEffect(() => {
    const normalized = addQuery.trim();
    const controller = new AbortController();

    if (addModalShelf === null || normalized.length < MIN_QUERY_LENGTH) {
      return () => controller.abort();
    }

    const timeout = window.setTimeout(async () => {
      setAddSearchLoading(true);
      try {
        console.log("[shelf-add/search] submitting query:", normalized);
        const response = await fetch(
          `/api/search?query=${encodeURIComponent(normalized)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error("Unable to search right now.");
        }

        const payload = (await response.json()) as {
          results?: BookSuggestion[];
        };
        setAddResults(payload.results ?? []);
      } catch {
        if (!controller.signal.aborted) {
          setAddResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setAddSearchLoading(false);
        }
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [addQuery, addModalShelf]);

  useEffect(() => {
    if (!bookWindow) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    void (async () => {
      try {
        // Stored books don't keep the Hardcover id, so find it by search and
        // match on slug (falling back to title) before loading the details.
        const query = `${bookWindow.title} ${bookWindow.authors}`.trim();
        const searchResponse = await fetch(
          `/api/search?query=${encodeURIComponent(query)}`,
          { signal },
        );
        if (!searchResponse.ok) {
          throw new Error("search failed");
        }
        const { results = [] } = (await searchResponse.json()) as {
          results?: BookSuggestion[];
        };
        const normalizedTitle = bookWindow.title.trim().toLowerCase();
        const match =
          results.find(
            (result) => bookWindow.slug && result.slug === bookWindow.slug,
          ) ??
          results.find(
            (result) => result.title.trim().toLowerCase() === normalizedTitle,
          ) ??
          results[0];
        if (!match) {
          throw new Error("no match");
        }

        const detailsResponse = await fetch(
          `/api/books/${encodeURIComponent(match.id)}`,
          { signal },
        );
        if (!detailsResponse.ok) {
          throw new Error("details failed");
        }
        const { book } = (await detailsResponse.json()) as {
          book?: BookDetails;
        };
        if (!book) {
          throw new Error("no details");
        }

        setBookWindowDetails(book);
        setBookWindowStatus("done");
      } catch {
        if (!signal.aborted) {
          setBookWindowStatus("error");
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [bookWindow]);

  function openBookWindow(book: BookDetails) {
    setBookWindowDetails(null);
    setBookWindowStatus("loading");
    setBookWindow(book);
  }

  async function chooseBook(book: BookSuggestion) {
    setModalError(null);
    try {
      console.log("[modal/book] submitting id:", book.id, "title:", book.title);
      const response = await fetch(`/api/books/${book.id}`);
      if (!response.ok) {
        throw new Error("Unable to load this book right now.");
      }

      const payload = (await response.json()) as { book: BookDetails | null };
      if (!payload.book?.coverUrl) {
        throw new Error("Please pick a book with a cover image.");
      }

      suppressNextSearchRef.current = true;
      setSelectedBook(payload.book);
      setBookQuery(payload.book.title);
      setSearchLoading(false);
      setBookResults([]);
    } catch (error) {
      setSelectedBook(null);
      setModalError(
        error instanceof Error ? error.message : "Could not select this book.",
      );
    }
  }

  function applyProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedName = nameInput.trim() || "anonymous";
    const selectedCoverUrl = selectedBook?.coverUrl ?? null;
    const nextName = selectedCoverUrl ? normalizedName : "anonymous";

    setModalError(null);
    setActiveName(nextName);
    setActiveCursorImage(selectedCoverUrl);

    const cursorsGlobal = (
      window as Window & {
        cursors?: { name?: string };
      }
    ).cursors;
    if (cursorsGlobal) {
      cursorsGlobal.name = nextName;
    }

    profileDraftRef.current = false;
    setModalOpen(false);
  }

  function dismissModal() {
    profileDraftRef.current = true;
    setModalOpen(false);
  }

  // Spreads onto a modal backdrop. Only dismisses when the press and the
  // release both land on the backdrop, so dragging a text selection out of a
  // modal doesn't close it.
  function backdropProps(onDismiss: () => void) {
    return {
      onMouseDown: (event: React.MouseEvent<HTMLElement>) => {
        backdropPressedRef.current = event.target === event.currentTarget;
      },
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        const pressedBackdrop = backdropPressedRef.current;
        backdropPressedRef.current = false;
        if (pressedBackdrop && event.target === event.currentTarget) {
          onDismiss();
        }
      },
    };
  }

  // Makes a modal box draggable by any part of it that isn't interactive.
  // The offset is kept per modal, so a moved modal stays put when reopened.
  function movable(id: string, style?: React.CSSProperties) {
    const offset = modalOffsets[id] ?? { x: 0, y: 0 };

    return {
      style: {
        ...style,
        translate: `${offset.x}px ${offset.y}px`,
        cursor: "move",
      } satisfies React.CSSProperties,
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        startModalDrag(id, event);
      },
    };
  }

  function startModalDrag(id: string, event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || event.pointerType === "touch") {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, button, a, label, img")) {
      return;
    }
    // Leave scrollbar presses alone so scrolling a list doesn't move the box.
    if (
      target.scrollHeight > target.clientHeight &&
      event.nativeEvent.offsetX >= target.clientWidth
    ) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const start = modalOffsets[id] ?? { x: 0, y: 0 };
    const startX = event.clientX;
    const startY = event.clientY;
    const margin = 48;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      // Keep a corner of the box on screen so it can't be lost off the edge.
      const dx = Math.min(
        Math.max(moveEvent.clientX - startX, margin - rect.width - rect.left),
        window.innerWidth - margin - rect.left,
      );
      const dy = Math.min(
        Math.max(moveEvent.clientY - startY, -rect.top),
        window.innerHeight - margin - rect.top,
      );
      setModalOffsets((current) => ({
        ...current,
        [id]: { x: start.x + dx, y: start.y + dy },
      }));
    };
    const onUp = () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function closeModal() {
    profileDraftRef.current = false;
    setModalError(null);

    if (!activeCursorImage) {
      setActiveName("anonymous");

      const cursorsGlobal = (
        window as Window & {
          cursors?: { name?: string };
        }
      ).cursors;
      if (cursorsGlobal) {
        cursorsGlobal.name = "anonymous";
      }
    }

    setModalOpen(false);
  }

  function openShelfAddModal(shelf: ShelfKey) {
    setAddModalShelf(shelf);
    if (addDraftShelfRef.current === shelf) {
      return;
    }
    setAddQuery("");
    setAddResults([]);
    setAddSearchLoading(false);
    setAddModalError(null);
    setAddingBookId(null);
  }

  function dismissShelfAddModal() {
    addDraftShelfRef.current = addModalShelf;
    setAddSearchLoading(false);
    setAddModalShelf(null);
  }

  function closeShelfAddModal() {
    addDraftShelfRef.current = null;
    setAddModalShelf(null);
    setAddQuery("");
    setAddResults([]);
    setAddSearchLoading(false);
    setAddModalError(null);
    setAddingBookId(null);
  }

  function triggerAddModalCsvUpload() {
    if (!addModalShelf) {
      return;
    }

    const shelf = addModalShelf;
    closeShelfAddModal();
    requestShelfEditAuth(() => {
      startShelfUpload(shelf);
    });
  }

  function triggerAddModalPasteUpload() {
    if (!addModalShelf) {
      return;
    }

    const shelf = addModalShelf;
    closeShelfAddModal();
    requestShelfEditAuth(() => {
      openPasteUploadModal(shelf);
    });
  }

  function requestShelfEditAuth(action: () => void | Promise<void>) {
    pendingShelfMutationRef.current = action;
    setEditPassword("");
    setEditAuthError(null);
    setEditAuthLoading(false);
    setEditAuthOpen(true);
  }

  function closeEditAuthModal() {
    pendingShelfMutationRef.current = null;
    setEditAuthOpen(false);
    setEditPassword("");
    setEditAuthError(null);
    setEditAuthLoading(false);
  }

  async function submitEditAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedPassword = editPassword.trim();
    if (trimmedPassword.length === 0) {
      setEditAuthError("Enter the shelf password.");
      return;
    }

    setEditAuthError(null);
    setEditAuthLoading(true);

    try {
      const response = await fetch("/api/shelves/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: trimmedPassword }),
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Password check failed.");
      }

      const action = pendingShelfMutationRef.current;
      closeEditAuthModal();

      if (!action) {
        return;
      }

      await action();
    } catch (error) {
      setEditAuthError(
        error instanceof Error ? error.message : "Password check failed.",
      );
    } finally {
      setEditAuthLoading(false);
    }
  }

  async function addBookToShelf(shelf: ShelfKey, book: BookSuggestion) {
    setAddModalError(null);
    setAddingBookId(book.id);
    setShelfPatch(shelf, {
      loading: true,
      error: null,
      submittingTitle: `${book.title} by ${book.authors}`,
    });

    try {
      console.log(
        "[shelf-add/book] submitting id:",
        book.id,
        "title:",
        book.title,
      );
      const response = await fetch(`/api/books/${book.id}`);

      if (!response.ok) {
        throw new Error("Could not add this book.");
      }

      const payload = (await response.json()) as { book: BookDetails | null };

      appendBooksToShelf(shelf, [
        {
          sourceTitle: book.title,
          sourceAuthor: book.authors || null,
          book: payload.book,
        },
      ]);

      closeShelfAddModal();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not add this book.";
      setAddModalError(message);
      setShelfPatch(shelf, { error: message });
    } finally {
      setShelfPatch(shelf, {
        loading: false,
        submittingTitle: null,
      });
      setAddingBookId(null);
    }
  }

  function addBookFromSearch(book: BookSuggestion) {
    if (!addModalShelf) {
      return;
    }

    const shelf = addModalShelf;
    requestShelfEditAuth(async () => {
      await addBookToShelf(shelf, book);
    });
  }

  function prioritizeUploadCandidates(
    input: CsvBookInput,
    candidates: BookSuggestion[],
  ) {
    const normalizedTitle = input.title.trim().toLowerCase();
    const expectedAuthor = input.author?.trim() ?? "";

    return [...candidates].sort((left, right) => {
      const leftAuthorMatch = expectedAuthor
        ? isLikelyAuthorMatch(left.authors, expectedAuthor)
        : false;
      const rightAuthorMatch = expectedAuthor
        ? isLikelyAuthorMatch(right.authors, expectedAuthor)
        : false;

      if (leftAuthorMatch !== rightAuthorMatch) {
        return leftAuthorMatch ? -1 : 1;
      }

      const leftExact = left.title.trim().toLowerCase() === normalizedTitle;
      const rightExact = right.title.trim().toLowerCase() === normalizedTitle;

      if (leftExact === rightExact) {
        return 0;
      }

      return leftExact ? -1 : 1;
    });
  }

  async function resolveUploadCandidates(input: CsvBookInput) {
    const initialMatchQuery = input.title.trim() || input.title;
    console.log("[Upload Match] Starting automatic match lookup", {
      title: input.title,
      author: input.author,
      queryUsedForAutomaticMatch: initialMatchQuery,
    });

    let searchPayload: { results?: BookSuggestion[] } = { results: [] };
    let attemptsUsed = 0;

    try {
      const searchResult = await fetchSearchResultsWithRetry(
        initialMatchQuery,
        "automatic_match",
      );
      searchPayload = { results: searchResult.results };
      attemptsUsed = searchResult.attempt;
    } catch (error) {
      console.warn("[Upload Match] Automatic match lookup failed", {
        queryUsedForAutomaticMatch: initialMatchQuery,
        attemptsTried: UPLOAD_SEARCH_MAX_ATTEMPTS,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return {
        candidates: [],
        recommendedTitles: [],
      };
    }

    const recommendedTitles = prioritizeUploadCandidates(
      input,
      searchPayload.results ?? [],
    ).slice(0, 3);

    const candidates = recommendedTitles.filter((candidate) =>
      Boolean(candidate.coverUrl),
    );

    console.log("[Upload Match] Automatic match results", {
      queryUsedForAutomaticMatch: initialMatchQuery,
      attemptsUsed,
      automaticMatchFound: candidates.length > 0,
      queryUsedForRecommendations: initialMatchQuery,
      recommendationCountBeforeCoverFilter: recommendedTitles.length,
      recommendations: recommendedTitles.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        authors: candidate.authors,
        hasCover: Boolean(candidate.coverUrl),
      })),
      matchesWithCoverCount: candidates.length,
    });

    return {
      candidates,
      recommendedTitles,
    };
  }

  function closeUploadMatchModal() {
    if (uploadImporting || hasAnyRowImporting) {
      return;
    }

    setUploadMatchHidden(false);
    setUploadMatchShelf(null);
    setUploadMatchRows([]);
    setUploadMatchError(null);
    setUploadDuplicateCount(0);
    setUploadRowSearchState({});
    setUploadRowImportState({});
  }

  function selectUploadCandidate(rowId: string, candidateId: string | null) {
    setUploadMatchRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) {
          return row;
        }

        return {
          ...row,
          selectedCandidateId: candidateId,
        };
      }),
    );
  }

  function deleteUploadMatchRow(rowId: string) {
    setUploadMatchRows((current) => current.filter((row) => row.id !== rowId));
    setUploadRowSearchState((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
    setUploadRowImportState((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
  }

  function toggleUploadRowSearch(rowId: string, defaultQuery: string) {
    setUploadRowSearchState((current) => {
      const rowState = current[rowId];

      if (!rowState) {
        console.log("[Upload Search] Opened manual search for row", {
          rowId,
          defaultSearchQuery: defaultQuery,
        });
        return {
          ...current,
          [rowId]: {
            open: true,
            query: defaultQuery,
            loading: false,
            results: [],
            error: null,
          },
        };
      }

      return {
        ...current,
        [rowId]: {
          ...rowState,
          open: !rowState.open,
          error: null,
        },
      };
    });
  }

  function setUploadRowSearchQuery(rowId: string, query: string) {
    setUploadRowSearchState((current) => ({
      ...current,
      [rowId]: {
        open: true,
        query,
        loading: false,
        results: current[rowId]?.results ?? [],
        error: null,
      },
    }));
  }

  async function searchUploadRowCandidates(rowId: string) {
    const row = uploadMatchRows.find((item) => item.id === rowId);
    const rowState = uploadRowSearchState[rowId];
    const normalizedQuery = rowState?.query.trim() ?? "";
    const initialMatchQuery = row?.sourceTitle.trim() ?? "";

    if (!row || normalizedQuery.length < MIN_QUERY_LENGTH) {
      console.log("[Upload Search] Skipped manual search", {
        rowId,
        reason: !row ? "row_not_found" : "query_too_short",
        minQueryLength: MIN_QUERY_LENGTH,
        attemptedSearchQuery: normalizedQuery,
      });
      return;
    }

    console.log("[Upload Search] Running manual search", {
      rowId,
      originalAutomaticMatchQuery: initialMatchQuery,
      manualSearchQuery: normalizedQuery,
      manualQueryMatchesOriginal:
        initialMatchQuery.toLowerCase() === normalizedQuery.toLowerCase(),
    });

    setUploadRowSearchState((current) => ({
      ...current,
      [rowId]: {
        open: true,
        query: normalizedQuery,
        loading: true,
        results: current[rowId]?.results ?? [],
        error: null,
      },
    }));

    try {
      const searchResult = await fetchSearchResultsWithRetry(
        normalizedQuery,
        "manual_row_search",
      );
      const payload = {
        results: searchResult.results,
      };

      const results = prioritizeUploadCandidates(
        {
          title: row.sourceTitle,
          author: row.sourceAuthor,
        },
        payload.results ?? [],
      )
        .filter((candidate) => Boolean(candidate.coverUrl))
        .slice(0, 8);

      console.log("[Upload Search] Manual search results", {
        rowId,
        manualSearchQuery: normalizedQuery,
        attemptsUsed: searchResult.attempt,
        manualSearchResultCount: results.length,
        results: results.map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          authors: candidate.authors,
        })),
      });

      setUploadRowSearchState((current) => ({
        ...current,
        [rowId]: {
          open: true,
          query: normalizedQuery,
          loading: false,
          results,
          error: null,
        },
      }));
    } catch (error) {
      setUploadRowSearchState((current) => ({
        ...current,
        [rowId]: {
          open: true,
          query: normalizedQuery,
          loading: false,
          results: current[rowId]?.results ?? [],
          error:
            error instanceof Error
              ? error.message
              : "Unable to search right now.",
        },
      }));

      console.warn("[Upload Search] Manual search failed", {
        rowId,
        manualSearchQuery: normalizedQuery,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  function applyUploadSearchCandidate(
    rowId: string,
    candidate: BookSuggestion,
  ) {
    const row = uploadMatchRows.find((item) => item.id === rowId);

    setUploadMatchRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) {
          return row;
        }

        return {
          ...row,
          candidates: [candidate],
          selectedCandidateId: candidate.id,
        };
      }),
    );

    setUploadRowSearchState((current) => ({
      ...current,
      [rowId]: {
        open: false,
        query: current[rowId]?.query ?? "",
        loading: false,
        results: current[rowId]?.results ?? [],
        error: null,
      },
    }));

    if (row) {
      void importUploadRow(row, candidate);
    }
  }

  async function importUploadRow(
    row: UploadMatchRow,
    candidate: BookSuggestion,
  ) {
    if (!uploadMatchShelf) {
      return;
    }

    const submittedLabel = row.sourceAuthor
      ? `${row.sourceTitle} by ${row.sourceAuthor}`
      : row.sourceTitle;

    setUploadMatchError(null);
    setUploadImporting(true);
    setUploadRowImportState((current) => ({
      ...current,
      [row.id]: {
        status: "importing",
        message: "Importing selected title...",
      },
    }));
    setShelfPatch(uploadMatchShelf, {
      loading: true,
      error: null,
      submittingTitle: submittedLabel,
    });

    try {
      const response = await fetch(`/api/books/${candidate.id}`);

      if (!response.ok) {
        throw new Error("Could not load selected book details.");
      }

      const payload = (await response.json()) as { book: BookDetails | null };
      if (!payload.book) {
        throw new Error("Book details were empty.");
      }

      appendBooksToShelf(uploadMatchShelf, [
        {
          sourceTitle: row.sourceTitle,
          sourceAuthor: row.sourceAuthor,
          book: payload.book,
        },
      ]);

      setUploadRowImportState((current) => ({
        ...current,
        [row.id]: {
          status: "success",
          message: "Imported successfully.",
        },
      }));
      setCollapsedShelves((current) => ({
        ...current,
        [uploadMatchShelf]: false,
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not import this title.";

      setUploadRowImportState((current) => ({
        ...current,
        [row.id]: {
          status: "error",
          message,
        },
      }));
      setUploadMatchError("One or more titles failed to import.");
    } finally {
      setShelfPatch(uploadMatchShelf, {
        loading: false,
        submittingTitle: null,
      });
      setUploadImporting(false);
    }
  }

  function retryUploadRow(rowId: string) {
    const row = uploadMatchRows.find((item) => item.id === rowId);
    if (!row) {
      return;
    }

    const candidate = row.candidates.find(
      (item) => item.id === row.selectedCandidateId,
    );
    if (!candidate) {
      setUploadRowImportState((current) => ({
        ...current,
        [rowId]: {
          status: "error",
          message: "Pick a title before retrying import.",
        },
      }));
      return;
    }

    void importUploadRow(row, candidate);
  }

  function setShelfPatch(shelf: ShelfKey, patch: Partial<ShelfState>) {
    setShelves((current) => ({
      ...current,
      [shelf]: {
        ...current[shelf],
        ...patch,
      },
    }));
  }

  function appendBooksToShelf(shelf: ShelfKey, nextRows: UploadedCsvBook[]) {
    setShelves((current) => ({
      ...current,
      [shelf]: {
        ...current[shelf],
        books: mergeUniqueShelfBooks(current[shelf].books, nextRows),
      },
    }));
  }

  function moveShelfBook(
    sourceShelf: ShelfKey,
    targetShelf: ShelfKey,
    titleKey: string,
  ) {
    if (sourceShelf === targetShelf) {
      return;
    }

    setShelves((current) => {
      const sourceBooks = current[sourceShelf].books;
      const targetBooks = current[targetShelf].books;
      const movedBook = sourceBooks.find(
        (item) => getUniqueTitleKey(item) === titleKey,
      );

      if (!movedBook) {
        return current;
      }

      const nextSourceBooks = sourceBooks.filter(
        (item) => getUniqueTitleKey(item) !== titleKey,
      );
      const alreadyInTarget = targetBooks.some(
        (item) => getUniqueTitleKey(item) === titleKey,
      );
      const nextTargetBooks = alreadyInTarget
        ? targetBooks
        : [...targetBooks, movedBook];

      return {
        ...current,
        [sourceShelf]: {
          ...current[sourceShelf],
          books: nextSourceBooks,
        },
        [targetShelf]: {
          ...current[targetShelf],
          books: nextTargetBooks,
        },
      };
    });
  }

  function getDraggedShelfBook(event: React.DragEvent<HTMLElement>) {
    const dragPayload = event.dataTransfer.getData(SHELF_BOOK_DRAG_MIME);

    if (dragPayload) {
      try {
        const parsed = JSON.parse(dragPayload) as DraggedShelfBook;
        if (
          parsed &&
          typeof parsed.sourceShelf === "string" &&
          typeof parsed.titleKey === "string"
        ) {
          return parsed;
        }
      } catch {
        // Ignore malformed drag data and fall back to local drag state.
      }
    }

    return draggedShelfBook;
  }

  function handleShelfDragOver(
    event: React.DragEvent<HTMLElement>,
    targetShelf: ShelfKey,
  ) {
    const payload = getDraggedShelfBook(event);
    if (!payload || payload.sourceShelf === targetShelf) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (activeDropShelf !== targetShelf) {
      setActiveDropShelf(targetShelf);
    }
  }

  function handleShelfDrop(
    event: React.DragEvent<HTMLElement>,
    targetShelf: ShelfKey,
  ) {
    event.preventDefault();
    setActiveDropShelf(null);

    const payload = getDraggedShelfBook(event);
    if (!payload || payload.sourceShelf === targetShelf) {
      return;
    }

    requestShelfEditAuth(() => {
      moveShelfBook(payload.sourceShelf, targetShelf, payload.titleKey);
    });
  }

  function handleShelfDropZoneLeave(event: React.DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setActiveDropShelf(null);
    }
  }

  function handleShelfDragEnd() {
    setDraggedShelfBook(null);
    setActiveDropShelf(null);
  }

  function removeShelfBookByKey(shelf: ShelfKey, titleKey: string) {
    setShelves((current) => ({
      ...current,
      [shelf]: {
        ...current[shelf],
        books: current[shelf].books.filter(
          (item) => getUniqueTitleKey(item) !== titleKey,
        ),
      },
    }));
  }

  function startShelfUpload(shelf: ShelfKey) {
    pendingUploadShelfRef.current = shelf;
    csvInputRef.current?.click();
  }

  function openPasteUploadModal(shelf: ShelfKey) {
    setPasteModalShelf(shelf);
    if (pasteDraftShelfRef.current === shelf) {
      return;
    }
    setPasteUploadText("");
    setPasteUploadError(null);
  }

  function dismissPasteUploadModal() {
    pasteDraftShelfRef.current = pasteModalShelf;
    setPasteModalShelf(null);
  }

  function closePasteUploadModal() {
    pasteDraftShelfRef.current = null;
    setPasteModalShelf(null);
    setPasteUploadText("");
    setPasteUploadError(null);
  }

  async function buildUploadMatchRows(
    shelf: ShelfKey,
    entries: CsvBookInput[],
    sourceLabel: "CSV" | "pasted list",
  ) {
    setUploadRowImportState({});

    const existingKeys = new Set<string>();
    for (const item of shelves[shelf].books) {
      const sourceKey = normalizeMatchValue(item.sourceTitle);
      if (sourceKey) {
        existingKeys.add(sourceKey);
      }

      const resolvedTitle = item.book?.title ?? "";
      const resolvedKey = normalizeMatchValue(resolvedTitle);
      if (resolvedKey) {
        existingKeys.add(resolvedKey);
      }
    }

    const nextMatchRows: UploadMatchRow[] = [];
    let duplicatesFound = 0;

    for (const entry of entries) {
      const entryKey = normalizeMatchValue(entry.title);
      if (entryKey && existingKeys.has(entryKey)) {
        duplicatesFound += 1;
        continue;
      }

      const submittedLabel = entry.author
        ? `${entry.title} by ${entry.author}`
        : entry.title;

      setShelfPatch(shelf, { submittingTitle: submittedLabel });

      const resolution = await resolveUploadCandidates(entry).catch(() => ({
        candidates: [],
        recommendedTitles: [],
      }));
      const rowId = crypto.randomUUID();

      console.log("[Upload Match] Added row to match modal", {
        source: sourceLabel,
        rowId,
        sourceTitle: entry.title,
        queryUsedForAutomaticMatch: entry.title.trim() || entry.title,
      });

      nextMatchRows.push({
        id: rowId,
        sourceTitle: entry.title,
        sourceAuthor: entry.author,
        candidates: resolution.candidates,
        recommendedTitles: resolution.recommendedTitles,
        selectedCandidateId: resolution.candidates[0]?.id ?? null,
      });
    }

    setUploadMatchRows(nextMatchRows);
    setUploadDuplicateCount(duplicatesFound);
    setUploadRowSearchState(
      Object.fromEntries(
        nextMatchRows.map((row) => [
          row.id,
          {
            open: false,
            query: row.sourceTitle,
            loading: false,
            results: [],
            error: null,
          } satisfies UploadRowSearchState,
        ]),
      ),
    );
    setCollapsedShelves((current) => ({
      ...current,
      [shelf]: false,
    }));
    setUploadMatchHidden(false);
    setUploadMatchShelf(shelf);
    setUploadMatchError(null);

    return {
      createdRows: nextMatchRows.length,
      duplicatesFound,
    };
  }

  async function submitPastedUploadList(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const shelf = pasteModalShelf;
    if (!shelf) {
      return;
    }

    setPasteUploadError(null);
    setShelfPatch(shelf, {
      loading: true,
      error: null,
      submittingTitle: null,
    });

    try {
      const entries = getBookInputsFromPastedList(pasteUploadText);
      if (entries.length === 0) {
        throw new Error("No titles found. Paste one title per line.");
      }

      await buildUploadMatchRows(shelf, entries, "pasted list");
      closePasteUploadModal();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not process pasted titles.";
      setPasteUploadError(message);
      setShelfPatch(shelf, {
        error: message,
      });
    } finally {
      setShelfPatch(shelf, {
        loading: false,
        submittingTitle: null,
      });
    }
  }

  async function handleCsvUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    const shelf = pendingUploadShelfRef.current;

    if (!file) {
      return;
    }

    setShelfPatch(shelf, {
      loading: true,
      error: null,
      submittingTitle: null,
    });

    try {
      const csvText = await file.text();
      const entries = getCsvBookInputsFromCsv(csvText);

      if (entries.length === 0) {
        throw new Error("No titles found in the second column.");
      }
      await buildUploadMatchRows(shelf, entries, "CSV");
    } catch (error) {
      setShelfPatch(shelf, {
        error:
          error instanceof Error
            ? error.message
            : "Could not process this CSV file.",
      });
    } finally {
      setShelfPatch(shelf, {
        loading: false,
        submittingTitle: null,
      });
      input.value = "";
      pendingUploadShelfRef.current = "booksRead";
    }
  }

  function renderShelfSection(shelf: ShelfKey, title: string) {
    const shelfState = shelves[shelf];
    const isCollapsed = collapsedShelves[shelf];
    const isDropTarget = activeDropShelf === shelf;

    return (
      <section
        className="border-t border-(--foreground) bg-(--site-bg) px-3 py-2"
        onDragOver={(event) => {
          handleShelfDragOver(event, shelf);
        }}
        onDragLeave={handleShelfDropZoneLeave}
        onDrop={(event) => {
          handleShelfDrop(event, shelf);
        }}
        style={{
          backgroundColor: isDropTarget ? "#eaf3dc" : undefined,
          transition: "background-color 140ms ease",
        }}
      >
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => {
              setCollapsedShelves((current) => ({
                ...current,
                [shelf]: !current[shelf],
              }));
            }}
            className="flex items-center gap-2 text-left"
            aria-expanded={!isCollapsed}
          >
            <span aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
            <span>{title}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              openShelfAddModal(shelf);
            }}
            className="border border-(--foreground) px-2 py-1 transition-colors hover:bg-[#dbe3c3]"
          >
            add
          </button>
          {shelfState.loading ? <div>loading books...</div> : null}
          {shelfState.submittingTitle ? (
            <div>{`submitting: ${shelfState.submittingTitle}`}</div>
          ) : null}
          {shelfState.error ? <div>{shelfState.error}</div> : null}
        </div>

        {!isCollapsed ? (
          <div className="mt-2 overflow-x-auto pb-1">
            <div className="flex min-w-max gap-2">
              {shelfState.books.map((item) => {
                const itemKey = getUniqueTitleKey(item);
                const isDragged =
                  draggedShelfBook?.sourceShelf === shelf &&
                  draggedShelfBook.titleKey === itemKey;

                return (
                  <div
                    key={itemKey}
                    className="shrink-0"
                    draggable
                    onDragStart={(event) => {
                      const payload: DraggedShelfBook = {
                        sourceShelf: shelf,
                        titleKey: itemKey,
                      };

                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(
                        SHELF_BOOK_DRAG_MIME,
                        JSON.stringify(payload),
                      );
                      event.dataTransfer.setData(
                        "text/plain",
                        item.sourceTitle,
                      );
                      setDraggedShelfBook(payload);
                    }}
                    onDragEnd={handleShelfDragEnd}
                    onDoubleClick={(event) => {
                      if ((event.target as HTMLElement).closest("button")) {
                        return;
                      }
                      if (item.book) {
                        openBookWindow(item.book);
                      }
                    }}
                    style={{
                      opacity: isDragged ? 0.45 : 1,
                      cursor: "grab",
                    }}
                  >
                    {item.book?.coverUrl ? (
                      <div className="group relative">
                        <button
                          type="button"
                          onClick={() => {
                            requestShelfEditAuth(() => {
                              removeShelfBookByKey(shelf, itemKey);
                            });
                          }}
                          className="absolute right-1 top-1 z-10 border-0 bg-transparent p-0 text-sm leading-none opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
                          aria-label={`remove ${item.book.title}`}
                        >
                          x
                        </button>

                        <img
                          src={item.book.coverUrl}
                          alt={`${item.book.title} cover`}
                          style={{
                            width: "88px",
                            height: "132px",
                            objectFit: "cover",
                          }}
                        />

                        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-(--site-bg)/90 p-2 text-xs opacity-0 transition-opacity group-hover:opacity-100">
                          <div>{item.book.title}</div>
                          <div>{item.book.authors}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="group relative" style={{ width: "88px" }}>
                        <button
                          type="button"
                          onClick={() => {
                            requestShelfEditAuth(() => {
                              removeShelfBookByKey(shelf, itemKey);
                            });
                          }}
                          className="absolute right-1 top-1 border-0 bg-transparent p-0 text-sm leading-none opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
                          aria-label={`remove ${item.sourceTitle}`}
                        >
                          x
                        </button>
                        <div className="text-xs">{`${item.sourceTitle} (not found)`}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <main
      className="flex h-[100svh] flex-col overflow-hidden bg-(--site-bg)"
      style={{ minHeight: "100svh" }}
    >
      <div
        className="z-20 flex items-center justify-between gap-3 px-3 pb-2"
        style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}
      >
        <input
          ref={csvInputRef}
          type="file"
          accept="text/csv,.csv"
          onChange={handleCsvUpload}
          className="hidden"
        />
        <button
          type="button"
          onClick={shuffleSiteColors}
          className="cursor-pointer border-0 bg-transparent p-0 text-left leading-none"
          style={{
            fontFamily: "var(--font-jacquarda-bastarda), serif",
            fontSize: "3.375rem",
          }}
          title="shuffle colors"
        >
          stacks
        </button>
        <div className="flex items-center gap-2">
          <div id={SITE_COLORS_ELEMENT_ID} hidden />
          {uploadMatchShelf && uploadMatchHidden ? (
            <button
              type="button"
              onClick={() => {
                setUploadMatchHidden(false);
              }}
              className="border border-(--foreground) bg-(--site-bg) px-3 py-1 transition-colors hover:bg-[#dbe3c3]"
            >
              resume import
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setColorsModalOpen(true);
            }}
            className="flex items-center justify-center border border-(--foreground) bg-(--site-bg) p-1.5 transition-colors hover:bg-[#dbe3c3]"
            aria-label="site colors"
            title="site colors"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.6-9-7.6Z" />
              <circle cx="7.5" cy="11" r="1" fill="currentColor" />
              <circle cx="10.5" cy="7" r="1" fill="currentColor" />
              <circle cx="15" cy="7.5" r="1" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => {
              setModalOpen(true);
              if (profileDraftRef.current) {
                return;
              }
              setModalError(null);
              setNameInput(activeName);
              setBookQuery(selectedBook?.title ?? "");
            }}
            className="border border-(--foreground) bg-(--site-bg) px-3 py-1 transition-colors hover:bg-[#dbe3c3]"
          >
            set my cursor
          </button>
        </div>
      </div>

      <div className="flex-1" />

      {bookWindow
        ? (() => {
            const shown = bookWindowDetails ?? bookWindow;
            const description = shown.description
              ?.replace(/<[^>]*>/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            const facts: Array<[string, string]> = [
              ["author", shown.authors || "unknown"],
              [
                "year",
                shown.releaseYear ? String(shown.releaseYear) : "unknown",
              ],
              ["pages", shown.pages ? String(shown.pages) : "unknown"],
              [
                "rating",
                typeof shown.rating === "number"
                  ? `${shown.rating.toFixed(1)} / 5`
                  : "unrated",
              ],
            ];

            return (
              <div
                className="fixed inset-0 flex items-center justify-center bg-black/20 p-4"
                {...backdropProps(() => setBookWindow(null))}
                style={{ zIndex: 2147483647 }}
              >
                <div
                  className="book-window relative w-full max-w-md bg-(--site-bg)"
                  {...movable("book", {
                    border: "2px solid var(--foreground)",
                    boxShadow: "5px 5px 0 var(--foreground)",
                  })}
                  role="dialog"
                  aria-label={shown.title}
                >
                  <div
                    className="flex items-center justify-between gap-2 px-2 py-1 text-sm"
                    style={{
                      background: "var(--foreground)",
                      color: "var(--site-bg)",
                    }}
                  >
                    <span className="truncate">{shown.title}</span>
                    <button
                      type="button"
                      onClick={() => setBookWindow(null)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center border border-(--site-bg) bg-transparent p-0 leading-none transition-opacity hover:opacity-70"
                      aria-label="close"
                    >
                      x
                    </button>
                  </div>

                  <div className="flex gap-3 p-3">
                    {shown.coverUrl ? (
                      <img
                        src={shown.coverUrl}
                        alt={`${shown.title} cover`}
                        className="shrink-0 border border-(--foreground)"
                        style={{
                          width: "112px",
                          height: "168px",
                          objectFit: "cover",
                        }}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="text-base leading-tight">
                        {shown.title}
                      </div>
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                        {facts.map(([label, value]) => (
                          <div key={label} className="contents">
                            <dt className="opacity-70">{label}</dt>
                            <dd className="m-0">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </div>

                  {description ? (
                    <div
                      className="mx-3 mb-3 max-h-28 overflow-y-auto border border-(--foreground) p-2 text-xs"
                      style={{ lineHeight: 1.4 }}
                    >
                      {description}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between border-t border-(--foreground) px-2 py-1 text-xs">
                    <span>
                      {bookWindowStatus === "loading"
                        ? "loading details..."
                        : bookWindowStatus === "error"
                          ? "showing saved details"
                          : ""}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()
        : null}

      {colorsModalOpen ? (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/45 p-4"
          {...backdropProps(() => setColorsModalOpen(false))}
          style={{ zIndex: 2147483647 }}
        >
          <div
            className="relative w-full max-w-sm bg-(--site-bg) p-5"
            {...movable("colors", { border: "1px solid var(--foreground)" })}
          >
            <button
              type="button"
              onClick={() => {
                setColorsModalOpen(false);
              }}
              className="absolute right-2 top-2 border-0 bg-transparent p-0 text-base leading-none transition-opacity hover:opacity-70"
              aria-label="close"
            >
              x
            </button>

            <div className="text-lg">color picker</div>
            <label className="mt-4 flex cursor-pointer items-center justify-between gap-3">
              <span>background</span>
              <input
                type="color"
                value={siteColors.background}
                onChange={(event) => {
                  updateSiteColor("background", event.target.value);
                }}
                aria-label="background color"
                className="h-8 w-12 cursor-pointer border border-(--foreground) bg-transparent p-0"
              />
            </label>
            <label className="mt-3 flex cursor-pointer items-center justify-between gap-3">
              <span>font</span>
              <input
                type="color"
                value={siteColors.text}
                onChange={(event) => {
                  updateSiteColor("text", event.target.value);
                }}
                aria-label="font color"
                className="h-8 w-12 cursor-pointer border border-(--foreground) bg-transparent p-0"
              />
            </label>
          </div>
        </div>
      ) : null}

      {modalOpen ? (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/45 p-4"
          {...backdropProps(dismissModal)}
          style={{ zIndex: 2147483647 }}
        >
          <form
            onSubmit={applyProfile}
            className="relative w-full max-w-xl bg-(--site-bg) p-5"
            {...movable("cursor", { border: "1px solid var(--foreground)" })}
          >
            <button
              type="button"
              onClick={closeModal}
              className="absolute right-2 top-2 border-0 bg-transparent p-0 text-base leading-none transition-opacity hover:opacity-70"
              aria-label="close"
            >
              x
            </button>

            <div className="text-lg">whats ur name</div>
            <input
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="type your name"
              className="mt-2 w-full border border-(--foreground) px-3 py-2"
              autoComplete="off"
            />

            <div className="mt-5 text-lg">what are you currently reading</div>
            <input
              value={bookQuery}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setBookQuery(nextQuery);
                setSelectedBook(null);
                setModalError(null);

                if (nextQuery.trim().length < MIN_QUERY_LENGTH) {
                  setBookResults([]);
                  setSearchLoading(false);
                }
              }}
              placeholder="search by book title or author"
              className="mt-2 w-full border border-(--foreground) px-3 py-2"
              autoComplete="off"
              spellCheck={false}
            />

            {searchLoading ? (
              <div className="mt-2 text-sm">searching...</div>
            ) : null}

            {bookResults.length > 0 ? (
              <div className="mt-2 max-h-56 overflow-auto border border-(--foreground)">
                {bookResults.map((book) => (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => {
                      void chooseBook(book);
                    }}
                    className="flex w-full items-center border-b border-(--foreground) px-3 py-2 text-left last:border-b-0 transition-colors hover:bg-[#dbe3c3]"
                  >
                    <div className="mr-3 h-14 w-10 shrink-0 overflow-hidden border border-(--foreground) bg-(--site-bg)">
                      {book.coverUrl ? (
                        <img
                          src={book.coverUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div>
                      {book.title} - {book.authors}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            {selectedBook?.coverUrl ? (
              <div className="mt-4 flex items-center gap-3">
                <img
                  src={selectedBook.coverUrl}
                  alt={`${selectedBook.title} cover`}
                  style={{ width: "56px", height: "84px", objectFit: "cover" }}
                />
                <div>
                  <div>{selectedBook.title}</div>
                  <div className="text-sm">{selectedBook.authors}</div>
                </div>
              </div>
            ) : null}

            {modalError ? (
              <div className="mt-3 text-sm">{modalError}</div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="submit"
                className="border border-(--foreground) px-3 py-2 transition-colors hover:bg-[#dbe3c3]"
              >
                set
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {addModalShelf ? (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/45 p-4"
          {...backdropProps(dismissShelfAddModal)}
          style={{ zIndex: 2147483647 }}
        >
          <div
            className="relative w-full max-w-xl bg-(--site-bg) p-5"
            {...movable("add", { border: "1px solid var(--foreground)" })}
          >
            <button
              type="button"
              onClick={closeShelfAddModal}
              className="absolute right-2 top-2 border-0 bg-transparent p-0 text-base leading-none transition-opacity hover:opacity-70"
              aria-label="close"
            >
              x
            </button>

            <div className="text-lg">add a book</div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <button
                type="button"
                onClick={triggerAddModalCsvUpload}
                className="border border-(--foreground) px-2 py-1 transition-colors hover:bg-[#dbe3c3]"
              >
                upload csv
              </button>
              <button
                type="button"
                onClick={triggerAddModalPasteUpload}
                className="border border-(--foreground) px-2 py-1 transition-colors hover:bg-[#dbe3c3]"
              >
                paste list
              </button>
              <span>or search and select below</span>
            </div>
            <input
              value={addQuery}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setAddQuery(nextQuery);
                setAddModalError(null);

                if (nextQuery.trim().length < MIN_QUERY_LENGTH) {
                  setAddResults([]);
                  setAddSearchLoading(false);
                }
              }}
              placeholder="search by book title or author"
              className="mt-2 w-full border border-(--foreground) px-3 py-2"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />

            {addSearchLoading ? (
              <div className="mt-2 text-sm">searching...</div>
            ) : null}

            {addResults.length > 0 ? (
              <div className="mt-2 max-h-72 overflow-auto border border-(--foreground)">
                {addResults.map((book) => {
                  const isAdding = addingBookId === book.id;

                  return (
                    <button
                      key={book.id}
                      type="button"
                      onClick={() => {
                        void addBookFromSearch(book);
                      }}
                      disabled={isAdding}
                      className="flex w-full items-center border-b border-(--foreground) px-3 py-2 text-left last:border-b-0 transition-colors hover:bg-[#dbe3c3] disabled:cursor-wait disabled:opacity-70"
                    >
                      <div className="mr-3 h-14 w-10 shrink-0 overflow-hidden border border-(--foreground) bg-(--site-bg)">
                        {book.coverUrl ? (
                          <img
                            src={book.coverUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div>
                        {isAdding
                          ? `adding ${book.title}...`
                          : `${book.title} - ${book.authors}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {addModalError ? (
              <div className="mt-3 text-sm">{addModalError}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {editAuthOpen ? (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/45 p-4"
          {...backdropProps(closeEditAuthModal)}
          style={{ zIndex: 2147483647 }}
        >
          <form
            onSubmit={submitEditAuth}
            className="relative w-full max-w-sm bg-(--site-bg) p-5"
            {...movable("auth", { border: "1px solid var(--foreground)" })}
          >
            <button
              type="button"
              onClick={closeEditAuthModal}
              className="absolute right-2 top-2 border-0 bg-transparent p-0 text-base leading-none transition-opacity hover:opacity-70"
              aria-label="close"
            >
              x
            </button>

            <div className="text-lg">enter shelf password</div>
            <input
              type="password"
              value={editPassword}
              onChange={(event) => {
                setEditPassword(event.target.value);
                setEditAuthError(null);
              }}
              placeholder="password"
              className="mt-2 w-full border border-(--foreground) px-3 py-2"
              autoComplete="off"
              autoFocus
            />

            {editAuthError ? (
              <div className="mt-3 text-sm">{editAuthError}</div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEditAuthModal}
                className="border border-(--foreground) px-3 py-2 transition-colors hover:bg-[#dbe3c3]"
              >
                cancel
              </button>
              <button
                type="submit"
                disabled={editAuthLoading}
                className="border border-(--foreground) px-3 py-2 transition-colors hover:bg-[#dbe3c3] disabled:cursor-wait disabled:opacity-70"
              >
                {editAuthLoading ? "checking..." : "unlock"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {uploadMatchShelf && !uploadMatchHidden ? (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/45 p-4"
          {...backdropProps(() => setUploadMatchHidden(true))}
          style={{ zIndex: 2147483647 }}
        >
          <div
            className="relative w-full max-w-4xl bg-(--site-bg) p-5"
            {...movable("upload", { border: "1px solid var(--foreground)" })}
          >
            <button
              type="button"
              onClick={closeUploadMatchModal}
              disabled={uploadImporting}
              className="absolute right-2 top-2 border-0 bg-transparent p-0 text-base leading-none transition-opacity hover:opacity-70 disabled:cursor-not-allowed"
              aria-label="close"
            >
              x
            </button>

            <div className="text-lg">pick matches to import</div>
            <div className="mt-2 text-sm">
              Showing rows that need help. Search and pick a title to import
              immediately.
            </div>
            {uploadDuplicateCount > 0 ? (
              <div className="mt-2 text-sm">
                {`${uploadDuplicateCount} duplicates already on this shelf were skipped.`}
              </div>
            ) : null}

            <div className="mt-4 max-h-[65vh] overflow-auto border border-(--foreground)">
              {displayedUploadRows.length === 0 ? (
                <div className="p-3 text-sm">
                  all unmatched rows were handled. click done to close.
                </div>
              ) : null}

              {displayedUploadRows.map((row) => {
                const rowSearchState = uploadRowSearchState[row.id];
                const importState = uploadRowImportState[row.id];
                const isImportingThisRow = importState?.status === "importing";
                const isImportedThisRow = importState?.status === "success";
                const importFailedThisRow = importState?.status === "error";

                return (
                  <div
                    key={row.id}
                    className="border-b border-(--foreground) p-3 last:border-b-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm font-medium">
                        {row.sourceAuthor
                          ? `${row.sourceTitle} - ${row.sourceAuthor}`
                          : row.sourceTitle}
                      </div>
                      <div className="flex items-center gap-2">
                        {row.candidates.length === 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              toggleUploadRowSearch(row.id, row.sourceTitle);
                            }}
                            disabled={isImportingThisRow || isImportedThisRow}
                            className="border border-(--foreground) px-2 py-1 text-xs transition-colors hover:bg-[#dbe3c3]"
                            aria-label={`search ${row.sourceTitle}`}
                          >
                            ⌕
                          </button>
                        ) : null}
                        {importFailedThisRow ? (
                          <button
                            type="button"
                            onClick={() => {
                              retryUploadRow(row.id);
                            }}
                            disabled={isImportingThisRow}
                            className="border border-(--foreground) px-2 py-1 text-xs transition-colors hover:bg-[#dbe3c3] disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            retry
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            deleteUploadMatchRow(row.id);
                          }}
                          disabled={isImportingThisRow}
                          className="border border-(--foreground) px-2 py-1 text-xs transition-colors hover:bg-[#dbe3c3]"
                          aria-label={`delete ${row.sourceTitle}`}
                        >
                          x delete
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {row.candidates.map((candidate) => {
                        const isSelected =
                          row.selectedCandidateId === candidate.id;
                        return (
                          <button
                            key={candidate.id}
                            type="button"
                            onClick={() => {
                              selectUploadCandidate(row.id, candidate.id);
                            }}
                            disabled={isImportingThisRow || isImportedThisRow}
                            className="flex items-center gap-2 border border-(--foreground) px-2 py-1 text-left transition-colors hover:bg-[#dbe3c3]"
                            style={{
                              backgroundColor: isSelected
                                ? "#dbe3c3"
                                : undefined,
                            }}
                          >
                            <div className="h-14 w-10 shrink-0 overflow-hidden border border-(--foreground) bg-(--site-bg)">
                              {candidate.coverUrl ? (
                                <img
                                  src={candidate.coverUrl}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : null}
                            </div>
                            <div className="text-xs">
                              <div>{candidate.title}</div>
                              <div>{candidate.authors}</div>
                            </div>
                          </button>
                        );
                      })}

                      {row.candidates.length === 0 ? (
                        <div className="text-xs">no cover found</div>
                      ) : null}
                    </div>

                    {!row.selectedCandidateId ? (
                      <div className="mt-2 text-xs">
                        choose a match or delete this row
                      </div>
                    ) : null}

                    {importState ? (
                      <div className="mt-2 text-xs">
                        {importState.status === "success"
                          ? `import success: ${importState.message}`
                          : importState.status === "error"
                            ? `import failed: ${importState.message}`
                            : importState.message}
                      </div>
                    ) : null}

                    {row.candidates.length === 0 && rowSearchState?.open ? (
                      <div className="mt-3 border border-(--foreground) p-2">
                        <div className="flex items-center gap-2">
                          <input
                            value={rowSearchState.query}
                            onChange={(event) => {
                              setUploadRowSearchQuery(
                                row.id,
                                event.target.value,
                              );
                            }}
                            placeholder="search by title"
                            className="w-full border border-(--foreground) px-2 py-1 text-xs"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              void searchUploadRowCandidates(row.id);
                            }}
                            disabled={
                              isImportingThisRow ||
                              isImportedThisRow ||
                              rowSearchState.loading ||
                              rowSearchState.query.trim().length <
                                MIN_QUERY_LENGTH
                            }
                            className="border border-(--foreground) px-2 py-1 text-xs transition-colors hover:bg-[#dbe3c3] disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {rowSearchState.loading ? "searching..." : "search"}
                          </button>
                        </div>

                        {rowSearchState.error ? (
                          <div className="mt-2 text-xs">
                            {rowSearchState.error}
                          </div>
                        ) : null}

                        {rowSearchState.results.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {rowSearchState.results.map((candidate) => (
                              <button
                                key={`${row.id}-${candidate.id}`}
                                type="button"
                                onClick={() => {
                                  applyUploadSearchCandidate(row.id, candidate);
                                }}
                                disabled={
                                  isImportingThisRow || isImportedThisRow
                                }
                                className="flex items-center gap-2 border border-(--foreground) px-2 py-1 text-left transition-colors hover:bg-[#dbe3c3]"
                              >
                                <div className="h-14 w-10 shrink-0 overflow-hidden border border-(--foreground) bg-(--site-bg)">
                                  {candidate.coverUrl ? (
                                    <img
                                      src={candidate.coverUrl}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  ) : null}
                                </div>
                                <div className="text-xs">
                                  <div>{candidate.title}</div>
                                  <div>{candidate.authors}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {uploadMatchError ? (
              <div className="mt-3 text-sm">{uploadMatchError}</div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeUploadMatchModal}
                disabled={uploadImporting || hasAnyRowImporting}
                className="border border-(--foreground) px-3 py-2 transition-colors hover:bg-[#dbe3c3] disabled:cursor-not-allowed disabled:opacity-70"
              >
                done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pasteModalShelf ? (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/45 p-4"
          {...backdropProps(dismissPasteUploadModal)}
          style={{ zIndex: 2147483647 }}
        >
          <form
            onSubmit={submitPastedUploadList}
            className="relative w-full max-w-2xl bg-(--site-bg) p-5"
            {...movable("paste", { border: "1px solid var(--foreground)" })}
          >
            <button
              type="button"
              onClick={closePasteUploadModal}
              className="absolute right-2 top-2 border-0 bg-transparent p-0 text-base leading-none transition-opacity hover:opacity-70"
              aria-label="close"
            >
              x
            </button>

            <div className="text-lg">paste books to upload</div>
            <div className="mt-2 text-sm">
              Paste one title per line. Optional author formats: title, author
              or title | author or tab-separated.
            </div>
            <textarea
              value={pasteUploadText}
              onChange={(event) => {
                setPasteUploadText(event.target.value);
                setPasteUploadError(null);
              }}
              placeholder={
                "Dune\nThe Left Hand of Darkness\nHow Should a Person Be?, Sheila Heti"
              }
              className="mt-3 h-72 w-full border border-(--foreground) px-3 py-2"
              spellCheck={false}
              autoFocus
            />

            {pasteUploadError ? (
              <div className="mt-3 text-sm">{pasteUploadError}</div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closePasteUploadModal}
                className="border border-(--foreground) px-3 py-2 transition-colors hover:bg-[#dbe3c3]"
              >
                cancel
              </button>
              <button
                type="submit"
                disabled={pasteUploadText.trim().length === 0}
                className="border border-(--foreground) px-3 py-2 transition-colors hover:bg-[#dbe3c3] disabled:cursor-not-allowed disabled:opacity-70"
              >
                find matches
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <section
        className="z-10 bg-(--site-bg)"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="border-t border-(--foreground) bg-(--site-bg) px-3 py-2 text-base">
          jordan&apos;s stacks
        </div>
        {renderShelfSection("currentlyReading", "currently reading")}
        {renderShelfSection("wantToRead", "want to read")}
        {renderShelfSection("booksRead", "read")}
      </section>
    </main>
  );
}
