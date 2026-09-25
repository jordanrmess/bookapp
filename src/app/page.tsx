"use client";

import "playhtml/dist/style.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayHTMLComponents, PresenceView } from "playhtml";

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

const MIN_QUERY_LENGTH = 2;
const CURSOR_IMAGE_CHANNEL = "bookCursorImage";
const COVER_CURSOR_CLASS = "book-cover-cursor";
const CURSOR_WIDTH = 102;
const CURSOR_HEIGHT = 144;
const CURSOR_BORDER_RADIUS = 9;

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

  // Backward-compatible fallback for any legacy flat shape.
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
  cover.style.border = "1px solid rgba(0, 0, 0, 0.28)";
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

export default function Home() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BookSuggestion[]>([]);
  const [selectedBook, setSelectedBook] = useState<BookDetails | null>(null);
  const [activeCursorImage, setActiveCursorImage] = useState<string | null>(
    null,
  );
  const [loadingResults, setLoadingResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suppressNextSearchRef = useRef(false);
  const playRef = useRef<PlayHTMLComponents | null>(null);
  const remoteCursorImageRef = useRef(new Map<string, string>());
  const remoteCursorElementRef = useRef(new Map<string, HTMLElement>());
  const localCursorElementRef = useRef<HTMLDivElement | null>(null);

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

            // PlayHTML writes default cursor SVG after this callback returns.
            // Defer our image overlay so it is not overwritten.
            queueMicrotask(() => {
              applyCoverCursor(
                element,
                remoteCursorImageRef.current.get(connectionId),
              );
            });

            return null;
          },
        },
      });

      playhtml.presence.setMyPresence(CURSOR_IMAGE_CHANNEL, {
        imageUrl: null,
      });

      unsubscribePresence = playhtml.presence.onPresenceChange(
        CURSOR_IMAGE_CHANNEL,
        (presences) => {
          const next = new Map(remoteCursorImageRef.current);

          presences.forEach((presence: PresenceView, key) => {
            const imageUrl = getImageUrlFromPresence(presence);
            const stableId = presence.playerIdentity?.publicKey;

            if (imageUrl) {
              next.set(key, imageUrl);
              if (stableId) {
                next.set(stableId, imageUrl);
              }
            } else {
              next.delete(key);
              if (stableId) {
                next.delete(stableId);
              }
            }
          });

          remoteCursorImageRef.current = next;

          remoteCursorElementRef.current.forEach((element, connectionId) => {
            applyCoverCursor(element, next.get(connectionId));
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
    });

    if (!activeCursorImage) {
      localCursorElementRef.current?.remove();
      localCursorElementRef.current = null;
      document.documentElement.style.removeProperty("cursor");
      document.body.style.removeProperty("cursor");
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
    cursor.style.border = "1px solid rgba(0, 0, 0, 0.28)";
    cursor.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.2)";
    cursor.style.backgroundImage = `url(${activeCursorImage})`;
    cursor.style.backgroundPosition = "center";
    cursor.style.backgroundRepeat = "no-repeat";
    cursor.style.backgroundSize = "cover";
    cursor.style.pointerEvents = "none";
    cursor.style.zIndex = "2147483647";

    const syncPosition = (event: MouseEvent) => {
      cursor.style.transform = `translate(${event.clientX + 8}px, ${event.clientY + 8}px)`;
    };

    document.body.appendChild(cursor);
    localCursorElementRef.current = cursor;
    document.documentElement.style.setProperty("cursor", "none", "important");
    document.body.style.setProperty("cursor", "none", "important");
    window.addEventListener("mousemove", syncPosition);

    return () => {
      window.removeEventListener("mousemove", syncPosition);
      cursor.remove();
      if (localCursorElementRef.current === cursor) {
        localCursorElementRef.current = null;
      }
      document.documentElement.style.removeProperty("cursor");
      document.body.style.removeProperty("cursor");
    };
  }, [activeCursorImage]);

  const trimmedQuery = query.trim();
  const showDropdown =
    trimmedQuery.length >= MIN_QUERY_LENGTH && results.length > 0;

  async function searchBooks(searchText: string, signal?: AbortSignal) {
    const normalizedQuery = searchText.trim();

    if (normalizedQuery.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoadingResults(false);
      setError(null);
      return;
    }

    setLoadingResults(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/search?query=${encodeURIComponent(normalizedQuery)}`,
        {
          signal,
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          payload?.error ?? "Unable to search Hardcover right now.",
        );
      }

      const payload = (await response.json()) as {
        results?: BookSuggestion[];
      };
      setResults(payload.results ?? []);
    } catch (fetchError) {
      if (!signal?.aborted) {
        setResults([]);
        setError(
          fetchError instanceof Error ? fetchError.message : "Search failed.",
        );
      }
    } finally {
      if (!signal?.aborted) {
        setLoadingResults(false);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();

    if (suppressNextSearchRef.current) {
      suppressNextSearchRef.current = false;
      return () => controller.abort();
    }

    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
      return () => controller.abort();
    }

    const timeout = window.setTimeout(async () => {
      await searchBooks(trimmedQuery, controller.signal);
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [trimmedQuery]);

  async function chooseBook(book: BookSuggestion) {
    setSelectedBook(null);
    setError(null);
    suppressNextSearchRef.current = true;
    setQuery(book.title);
    setResults([]);

    try {
      const response = await fetch(`/api/books/${book.id}`);

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Unable to load the selected cover.");
      }

      const payload = (await response.json()) as { book: BookDetails | null };

      if (!payload.book) {
        throw new Error("No book details were returned for that selection.");
      }

      setSelectedBook(payload.book);
    } catch (selectError) {
      setError(
        selectError instanceof Error
          ? selectError.message
          : "Failed to load book details.",
      );
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await searchBooks(query);
  }

  function setCursorFromSelection() {
    if (!selectedBook?.coverUrl) {
      setError("This book does not include a cover image for the cursor.");
      return;
    }

    setError(null);
    setActiveCursorImage(selectedBook.coverUrl);
  }

  const statusCopy = useMemo(() => {
    if (error) {
      return error;
    }

    if (loadingResults) {
      return "Searching Hardcover…";
    }

    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
      return "Type at least two characters to search.";
    }

    if (results.length === 0) {
      return "No matches yet. Try another title.";
    }

    return `${results.length} result${results.length === 1 ? "" : "s"} ready.`;
  }, [error, loadingResults, results.length, trimmedQuery.length]);

  return (
    <main className="min-h-screen bg-white px-4 py-8 text-green-700">
      <section className="mx-auto flex max-w-xl flex-col gap-4">
        <label htmlFor="book-search">Book title</label>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3"
          style={{ border: "1px solid currentColor", padding: "8px" }}
        >
          <input
            id="book-search"
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);

              if (nextQuery.trim().length < MIN_QUERY_LENGTH) {
                setResults([]);
                setLoadingResults(false);
                setError(null);
              }

              setSelectedBook(null);
            }}
            placeholder="Type a book title or author"
            autoComplete="off"
            spellCheck={false}
          />

          <button type="submit">Search</button>
        </form>

        <p>{statusCopy}</p>

        {showDropdown ? (
          <div style={{ border: "1px solid currentColor", padding: "8px" }}>
            <div>Matches</div>
            <div className="flex flex-col gap-2">
              {results.map((book) => (
                <button
                  key={book.id}
                  type="button"
                  className="dropdown-item"
                  onClick={() => {
                    void chooseBook(book);
                  }}
                >
                  {book.title} - {book.authors}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div style={{ border: "1px solid currentColor", padding: "8px" }}>
          <div>Results</div>
          {selectedBook ? (
            <div className="flex flex-col gap-2">
              <div>
                {selectedBook.title} - {selectedBook.authors}
              </div>
              {selectedBook.coverUrl ? (
                <div className="flex flex-col gap-2">
                  <img
                    src={selectedBook.coverUrl}
                    alt={`${selectedBook.title} cover`}
                    style={{ width: "10%", height: "auto", display: "block" }}
                  />
                  <button type="button" onClick={setCursorFromSelection}>
                    set cursor
                  </button>
                </div>
              ) : null}
              {activeCursorImage ? <div>Cursor image is live.</div> : null}
            </div>
          ) : (
            <div>No book selected.</div>
          )}
        </div>
      </section>
    </main>
  );
}
