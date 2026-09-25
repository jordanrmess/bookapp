const HARDOVER_API_URL = "https://api.hardcover.app/v1/graphql";

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type SearchBookRow = {
  id?: number | string;
  title?: string | null;
  author_names?: unknown;
  slug?: string | null;
};

type SearchResultsContainer = {
  results?: unknown;
  hits?: unknown;
  documents?: unknown;
};

type SearchHit = {
  document?: SearchBookRow;
  id?: number | string;
  title?: string | null;
  author_names?: unknown;
  slug?: string | null;
};

type BookRow = {
  id?: number | string;
  title?: string | null;
  slug?: string | null;
  pages?: number | null;
  release_year?: number | null;
  description?: string | null;
  rating?: number | null;
  image?: {
    url?: string | null;
  } | null;
  contributions?: Array<{
    author?: {
      name?: string | null;
    } | null;
  }>;
};

export type BookSuggestion = {
  id: string;
  title: string;
  authors: string;
  slug: string | null;
};

export type BookDetails = {
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

function getToken() {
  const token = process.env.HARDCOVER_API_KEY;

  if (!token) {
    throw new Error("Missing HARDCOVER_API_KEY environment variable.");
  }

  return token;
}

async function hardcoverRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
) {
  const response = await fetch(HARDOVER_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getToken()}`,
      "user-agent": "booksrus/0.1.0",
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response
    .json()
    .catch(() => null)) as GraphQLResponse<T> | null;

  if (!response.ok) {
    const message =
      payload?.errors?.[0]?.message ??
      `Hardcover request failed with ${response.status}.`;
    throw new Error(message);
  }

  if (!payload?.data) {
    throw new Error("Hardcover returned no data.");
  }

  return payload.data;
}

function formatAuthors(
  authorNames: unknown,
  contributions?: BookRow["contributions"],
) {
  if (Array.isArray(authorNames)) {
    const text = authorNames.filter(Boolean).join(", ");

    if (text) {
      return text;
    }
  }

  if (typeof authorNames === "string" && authorNames) {
    return authorNames;
  }

  const names =
    contributions
      ?.map((contribution) => contribution?.author?.name)
      .filter((name): name is string => Boolean(name)) ?? [];

  return names.length > 0 ? names.join(", ") : "Unknown author";
}

function normalizeSearchRows(rawResults: unknown): SearchBookRow[] {
  if (Array.isArray(rawResults)) {
    return rawResults.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const hit = item as SearchHit;

      return hit.document ? [hit.document] : [item as SearchBookRow];
    });
  }

  if (typeof rawResults === "string") {
    try {
      return normalizeSearchRows(JSON.parse(rawResults));
    } catch {
      return [];
    }
  }

  if (!rawResults || typeof rawResults !== "object") {
    return [];
  }

  const container = rawResults as SearchResultsContainer;

  if (Array.isArray(container.results)) {
    return normalizeSearchRows(container.results);
  }

  if (Array.isArray(container.hits)) {
    return container.hits.flatMap((hit) => {
      if (!hit || typeof hit !== "object") {
        return [];
      }

      const searchHit = hit as SearchHit;

      if (searchHit.document) {
        return [searchHit.document];
      }

      return [
        {
          id: searchHit.id,
          title: searchHit.title,
          author_names: searchHit.author_names,
          slug: searchHit.slug,
        },
      ];
    });
  }

  if (Array.isArray(container.documents)) {
    return container.documents as SearchBookRow[];
  }

  return [];
}

export async function searchBooks(query: string) {
  const data = await hardcoverRequest<{
    search?: SearchResultsContainer;
  }>(
    `
      query SearchBooks($query: String!, $perPage: Int!, $page: Int!, $fields: String!, $weights: String!, $typos: String!) {
        search(
          query: $query,
          query_type: "Book",
          per_page: $perPage,
          page: $page,
          fields: $fields,
          weights: $weights,
          typos: $typos
        ) {
          results
        }
      }
    `,
    {
      query,
      perPage: 8,
      page: 1,
      fields: "title,author_names",
      weights: "5,3",
      typos: "3,3",
    },
  );

  const rows = normalizeSearchRows(data.search?.results ?? data.search);

  return rows
    .map((row) => ({
      id: String(row.id ?? ""),
      title: row.title?.trim() ?? "Untitled book",
      authors: formatAuthors(row.author_names),
      slug: row.slug ?? null,
    }))
    .filter((row) => row.id.length > 0);
}

export async function getBookById(id: string) {
  const bookId = Number(id);

  if (!Number.isFinite(bookId)) {
    throw new Error("Invalid book id.");
  }

  const data = await hardcoverRequest<{ books?: BookRow[] }>(
    `
      query BookById($id: Int!) {
        books(where: { id: { _eq: $id } }, limit: 1) {
          id
          title
          slug
          pages
          release_year
          description
          rating
          image {
            url
          }
          contributions {
            author {
              name
            }
          }
        }
      }
    `,
    { id: bookId },
  );

  const book = data.books?.[0];

  if (!book?.id) {
    return null;
  }

  return {
    id: String(book.id),
    title: book.title?.trim() ?? "Untitled book",
    authors: formatAuthors(undefined, book.contributions),
    coverUrl: book.image?.url ?? null,
    pages: book.pages ?? null,
    releaseYear: book.release_year ?? null,
    description: book.description ?? null,
    rating: typeof book.rating === "number" ? book.rating : null,
    slug: book.slug ?? null,
  } satisfies BookDetails;
}
