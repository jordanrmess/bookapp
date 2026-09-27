This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Hardcover setup

This app expects a Hardcover personal access token on the server. Create a `.env.local` file in the project root and set:

```bash
HARDCOVER_API_KEY=your_token_here
```

You can copy the provided `.env.local.example` file as a starting point.

## Supabase shelf persistence

This app supports saving the two bookshelf collections (want to read and books i've read) to Supabase while keeping cursor/profile state and PlayHTML presence separate from the shelf database logic.

Create `.env.local` entries like:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-if-needed-for-server-side-writes
SHELF_EDIT_PASSWORD=choose_a_password_for_shelf_edits
```

The repo also includes a SQL schema at `supabase/schema.sql` for the `shelves` and `books` tables. In prototype mode, the app uses a browser-local anonymous identifier so unauthenticated users still keep their shelf data without needing app auth.

`SHELF_EDIT_PASSWORD` is used by `/api/shelves/verify` so shelf changes (add/upload/remove/clear) require a quick password check modal before mutating either shelf.

The schema enables Row Level Security and defines explicit policies so Supabase security warnings are resolved. These policies are intentionally permissive for prototype mode because shelf writes happen directly from the browser with anon keys.
For production-grade isolation, move shelf reads/writes to server routes and apply user-scoped RLS policies.

If you created the `shelves` table before this schema, you may have an older `shelf_name` check constraint that rejects camelCase values like `currentlyReading`.
Run `supabase/schema.sql` again (or at least the `alter table ... shelves_shelf_name_check` block) in Supabase SQL editor to align existing environments.

## What the app does

Type a book title, choose a match from the dropdown, and the selected book's cover will render on the right. The browser talks to local API routes only; those routes forward requests to Hardcover with your token.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
