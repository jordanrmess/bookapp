"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

export default function Home() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BookSuggestion[]>([]);
  const [selectedBook, setSelectedBook] = useState<BookDetails | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suppressNextSearchRef = useRef(false);

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
                <img
                  src={selectedBook.coverUrl}
                  alt={`${selectedBook.title} cover`}
                  style={{ width: "10%", height: "auto", display: "block" }}
                />
              ) : null}
            </div>
          ) : (
            <div>No book selected.</div>
          )}
        </div>
      </section>
    </main>
  );
}
