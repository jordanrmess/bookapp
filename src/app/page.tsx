"use client";

import "playhtml/dist/style.css";
import { useEffect, useRef, useState } from "react";
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
  label.textContent = name;
  label.style.position = "absolute";
  label.style.left = "0";
  label.style.top = `${CURSOR_HEIGHT + 6}px`;
  label.style.padding = "4px 8px";
  label.style.fontSize = "12px";
  label.style.lineHeight = "1";
  label.style.borderRadius = "999px";
  label.style.background = "rgba(255, 255, 255, 0.92)";
  label.style.border = "1px solid rgba(0, 0, 0, 0.2)";
  label.style.color = "#0f172a";
  label.style.whiteSpace = "nowrap";
  label.style.pointerEvents = "none";

  if (!existing) {
    element.appendChild(label);
  }
}

export default function Home() {
  const [modalOpen, setModalOpen] = useState(true);
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

  const playRef = useRef<PlayHTMLComponents | null>(null);
  const remoteCursorIdentityRef = useRef(new Map<string, CursorIdentity>());
  const remoteCursorElementRef = useRef(new Map<string, HTMLElement>());
  const localCursorElementRef = useRef<HTMLDivElement | null>(null);
  const suppressNextSearchRef = useRef(false);

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
    cursor.style.zIndex = "20";

    const nameTag = document.createElement("div");
    nameTag.textContent = activeName || "reader";
    nameTag.style.position = "absolute";
    nameTag.style.left = "0";
    nameTag.style.top = `${CURSOR_HEIGHT + 6}px`;
    nameTag.style.padding = "4px 8px";
    nameTag.style.fontSize = "12px";
    nameTag.style.lineHeight = "1";
    nameTag.style.borderRadius = "999px";
    nameTag.style.background = "rgba(255, 255, 255, 0.92)";
    nameTag.style.border = "1px solid rgba(0, 0, 0, 0.2)";
    nameTag.style.color = "#0f172a";
    nameTag.style.whiteSpace = "nowrap";
    cursor.appendChild(nameTag);

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
  }, [activeCursorImage, activeName]);

  useEffect(() => {
    document.body.classList.toggle("profile-modal-open", modalOpen);

    return () => {
      document.body.classList.remove("profile-modal-open");
    };
  }, [modalOpen]);

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

  async function chooseBook(book: BookSuggestion) {
    setModalError(null);
    try {
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

    const normalizedName = nameInput.trim();
    if (!normalizedName) {
      setModalError("Please enter your name.");
      return;
    }

    if (!selectedBook?.coverUrl) {
      setModalError("Please choose what you are currently reading.");
      return;
    }

    setModalError(null);
    setActiveName(normalizedName);
    setActiveCursorImage(selectedBook.coverUrl);

    const cursorsGlobal = (
      window as Window & {
        cursors?: { name?: string };
      }
    ).cursors;
    if (cursorsGlobal) {
      cursorsGlobal.name = normalizedName;
    }

    setModalOpen(false);
  }

  return (
    <main className="relative min-h-screen bg-white">
      <button
        type="button"
        onClick={() => {
          setModalOpen(true);
          setModalError(null);
          setNameInput(activeName);
          setBookQuery(selectedBook?.title ?? "");
        }}
        className="absolute left-3 top-3 z-20 border border-black bg-white px-3 py-1 text-black"
      >
        update
      </button>

      {modalOpen ? (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/45 p-4"
          style={{ zIndex: 2147483647 }}
        >
          <form
            onSubmit={applyProfile}
            className="w-full max-w-xl bg-white p-5 text-black"
            style={{ border: "1px solid black" }}
          >
            <div className="text-lg">whats ur name</div>
            <input
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="type your name"
              className="mt-2 w-full border border-black px-3 py-2"
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
              className="mt-2 w-full border border-black px-3 py-2"
              autoComplete="off"
              spellCheck={false}
            />

            {searchLoading ? (
              <div className="mt-2 text-sm">searching...</div>
            ) : null}

            {bookResults.length > 0 ? (
              <div className="mt-2 max-h-56 overflow-auto border border-black">
                {bookResults.map((book) => (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => {
                      void chooseBook(book);
                    }}
                    className="block w-full border-b border-black px-3 py-2 text-left last:border-b-0 hover:bg-gray-100"
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
                  <div className="text-sm text-gray-600">
                    {selectedBook.authors}
                  </div>
                </div>
              </div>
            ) : null}

            {modalError ? (
              <div className="mt-3 text-sm text-red-700">{modalError}</div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button type="submit" className="border border-black px-3 py-2">
                save
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
