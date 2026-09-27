"use client";

import "playhtml/dist/style.css";
import { useEffect, useRef, useState } from "react";
import type { PlayHTMLComponents, PresenceView } from "playhtml";
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

type ShelfKey = "wantToRead" | "currentlyReading" | "booksRead";
const SHELF_ORDER: ShelfKey[] = ["currentlyReading", "wantToRead", "booksRead"];

type ShelfState = {
  books: UploadedCsvBook[];
  loading: boolean;
  error: string | null;
  submittingTitle: string | null;
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
const CURSOR_IMAGE_CHANNEL = "bookCursorImage";
const COVER_CURSOR_CLASS = "book-cover-cursor";
const CURSOR_NAME_CLASS = "book-cursor-name";
const CURSOR_WIDTH = 102;
const CURSOR_HEIGHT = 144;
const CURSOR_BORDER_RADIUS = 9;

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

export default function Home() {
  const [modalOpen, setModalOpen] = useState(false);
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
  const [clearConfirmShelf, setClearConfirmShelf] = useState<ShelfKey | null>(
    null,
  );
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
  const isAnyModalOpen =
    modalOpen ||
    addModalShelf !== null ||
    clearConfirmShelf !== null ||
    editAuthOpen;

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

    const syncPosition = (event: MouseEvent) => {
      cursor.style.transform = `translate(${event.clientX + 10}px, ${event.clientY - 8}px)`;
    };

    document.body.appendChild(cursor);
    localCursorElementRef.current = cursor;
    window.addEventListener("mousemove", syncPosition);

    return () => {
      window.removeEventListener("mousemove", syncPosition);
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

    setModalOpen(false);
  }

  function closeModal() {
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
    setAddQuery("");
    setAddResults([]);
    setAddSearchLoading(false);
    setAddModalError(null);
    setAddingBookId(null);
  }

  function closeShelfAddModal() {
    setAddModalShelf(null);
    setAddQuery("");
    setAddResults([]);
    setAddSearchLoading(false);
    setAddModalError(null);
    setAddingBookId(null);
  }

  function openClearConfirm(shelf: ShelfKey) {
    setClearConfirmShelf(shelf);
  }

  function closeClearConfirm() {
    setClearConfirmShelf(null);
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

  function confirmClearShelf() {
    const shelfToClear = clearConfirmShelf;
    if (!shelfToClear) {
      return;
    }

    closeClearConfirm();
    requestShelfEditAuth(() => {
      clearShelf(shelfToClear);
    });
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

  async function resolveBookFromInput(input: CsvBookInput) {
    console.log(
      "[upload/search] submitting title:",
      input.title,
      "author:",
      input.author,
    );
    const searchResponse = await fetch(
      `/api/search?query=${encodeURIComponent(input.title)}`,
    );

    if (!searchResponse.ok) {
      return null;
    }

    const searchPayload = (await searchResponse.json()) as {
      results?: BookSuggestion[];
    };
    const candidates = searchPayload.results ?? [];

    if (candidates.length === 0) {
      return null;
    }

    const normalizedTitle = input.title.trim().toLowerCase();
    const expectedAuthor = input.author?.trim() ?? "";
    const prioritizedCandidates = [...candidates].sort((left, right) => {
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

    let coverAuthorMatch: BookDetails | null = null;
    let coverFallback: BookDetails | null = null;

    for (const candidate of prioritizedCandidates) {
      console.log(
        "[upload/book] submitting candidate id:",
        candidate.id,
        "candidate title:",
        candidate.title,
        "for source title:",
        input.title,
        "source author:",
        input.author,
      );
      const bookResponse = await fetch(`/api/books/${candidate.id}`);
      if (!bookResponse.ok) {
        console.log(
          "[upload/book] candidate failed:",
          candidate.id,
          "status:",
          bookResponse.status,
        );
        continue;
      }

      const bookPayload = (await bookResponse.json()) as {
        book: BookDetails | null;
      };

      const resolvedBook = bookPayload.book;
      if (!resolvedBook) {
        continue;
      }

      const authorMatch = expectedAuthor
        ? isLikelyAuthorMatch(resolvedBook.authors, expectedAuthor)
        : false;

      if (!resolvedBook.coverUrl) {
        continue;
      }

      if (authorMatch || !expectedAuthor) {
        coverAuthorMatch = resolvedBook;
        break;
      }

      if (!coverFallback) {
        coverFallback = resolvedBook;
      }
    }

    return coverAuthorMatch ?? coverFallback;
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

  function clearShelf(shelf: ShelfKey) {
    setShelves((current) => ({
      ...current,
      [shelf]: createShelfState(),
    }));
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

      const nextRows: UploadedCsvBook[] = [];

      for (const entry of entries) {
        const submittedLabel = entry.author
          ? `${entry.title} by ${entry.author}`
          : entry.title;

        setShelfPatch(shelf, { submittingTitle: submittedLabel });

        try {
          const book = await resolveBookFromInput(entry);
          nextRows.push({
            sourceTitle: entry.title,
            sourceAuthor: entry.author,
            book,
          });
        } catch {
          nextRows.push({
            sourceTitle: entry.title,
            sourceAuthor: entry.author,
            book: null,
          });
        }
      }

      appendBooksToShelf(shelf, nextRows);
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

    return (
      <section className="border-t border-[#235848] bg-white px-3 py-2">
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
              requestShelfEditAuth(() => {
                startShelfUpload(shelf);
              });
            }}
            className="border border-[#235848] px-2 py-1 transition-colors hover:bg-[#dbe3c3]"
          >
            upload
          </button>
          <button
            type="button"
            onClick={() => {
              openShelfAddModal(shelf);
            }}
            className="border border-[#235848] px-2 py-1 transition-colors hover:bg-[#dbe3c3]"
          >
            add
          </button>
          <button
            type="button"
            onClick={() => {
              openClearConfirm(shelf);
            }}
            className="border border-[#235848] px-2 py-1 transition-colors hover:bg-[#dbe3c3]"
          >
            clear
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

                return (
                  <div key={itemKey} className="shrink-0">
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

                        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-white/90 p-2 text-xs opacity-0 transition-opacity group-hover:opacity-100">
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
      className="relative min-h-screen bg-white"
      style={{ paddingBottom: "360px" }}
    >
      <div className="absolute left-3 top-3 z-20 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setModalOpen(true);
            setModalError(null);
            setNameInput(activeName);
            setBookQuery(selectedBook?.title ?? "");
          }}
          className="border border-[#235848] bg-white px-3 py-1 transition-colors hover:bg-[#dbe3c3]"
        >
          set cursor
        </button>
        <input
          ref={csvInputRef}
          type="file"
          accept="text/csv,.csv"
          onChange={handleCsvUpload}
          className="hidden"
        />
        <div className="text-lg">welcome to book club</div>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/45 p-4"
          style={{ zIndex: 2147483647 }}
        >
          <form
            onSubmit={applyProfile}
            className="relative w-full max-w-xl bg-white p-5"
            style={{ border: "1px solid #235848" }}
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
              className="mt-2 w-full border border-[#235848] px-3 py-2"
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
              className="mt-2 w-full border border-[#235848] px-3 py-2"
              autoComplete="off"
              spellCheck={false}
            />

            {searchLoading ? (
              <div className="mt-2 text-sm">searching...</div>
            ) : null}

            {bookResults.length > 0 ? (
              <div className="mt-2 max-h-56 overflow-auto border border-[#235848]">
                {bookResults.map((book) => (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => {
                      void chooseBook(book);
                    }}
                    className="block w-full border-b border-[#235848] px-3 py-2 text-left last:border-b-0 transition-colors hover:bg-[#dbe3c3]"
                  >
                    {book.title} - {book.authors}
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
                className="border border-[#235848] px-3 py-2 transition-colors hover:bg-[#dbe3c3]"
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
          style={{ zIndex: 2147483647 }}
        >
          <div
            className="relative w-full max-w-xl bg-white p-5"
            style={{ border: "1px solid #235848" }}
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
              className="mt-2 w-full border border-[#235848] px-3 py-2"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />

            {addSearchLoading ? (
              <div className="mt-2 text-sm">searching...</div>
            ) : null}

            {addResults.length > 0 ? (
              <div className="mt-2 max-h-72 overflow-auto border border-[#235848]">
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
                      className="block w-full border-b border-[#235848] px-3 py-2 text-left last:border-b-0 transition-colors hover:bg-[#dbe3c3] disabled:cursor-wait disabled:opacity-70"
                    >
                      {isAdding
                        ? `adding ${book.title}...`
                        : `${book.title} - ${book.authors}`}
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

      {clearConfirmShelf ? (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/45 p-4"
          style={{ zIndex: 2147483647 }}
        >
          <div
            className="relative w-full max-w-md bg-white p-5"
            style={{ border: "1px solid #235848" }}
          >
            <div className="text-lg">are you sure?</div>
            <div className="mt-3 text-sm">
              {clearConfirmShelf === "wantToRead"
                ? "This will clear all books from want to read."
                : clearConfirmShelf === "currentlyReading"
                  ? "This will clear all books from currently reading."
                  : "This will clear all books from books i've read."}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeClearConfirm}
                className="border border-[#235848] px-3 py-2 transition-colors hover:bg-[#dbe3c3]"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={confirmClearShelf}
                className="border border-[#235848] px-3 py-2 transition-colors hover:bg-[#dbe3c3]"
              >
                clear shelf
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editAuthOpen ? (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/45 p-4"
          style={{ zIndex: 2147483647 }}
        >
          <form
            onSubmit={submitEditAuth}
            className="relative w-full max-w-sm bg-white p-5"
            style={{ border: "1px solid #235848" }}
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
              className="mt-2 w-full border border-[#235848] px-3 py-2"
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
                className="border border-[#235848] px-3 py-2 transition-colors hover:bg-[#dbe3c3]"
              >
                cancel
              </button>
              <button
                type="submit"
                disabled={editAuthLoading}
                className="border border-[#235848] px-3 py-2 transition-colors hover:bg-[#dbe3c3] disabled:cursor-wait disabled:opacity-70"
              >
                {editAuthLoading ? "checking..." : "unlock"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <section className="fixed bottom-0 left-0 right-0 z-10 bg-white">
        <div className="border-t border-[#235848] bg-white px-3 py-2 text-base">
          jordan&apos;s stacks
        </div>
        {renderShelfSection("currentlyReading", "currently reading")}
        {renderShelfSection("wantToRead", "want to read")}
        {renderShelfSection("booksRead", "books i've read")}
      </section>
    </main>
  );
}
