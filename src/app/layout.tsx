import type { Metadata } from "next";
import { Geist, Geist_Mono, Jacquarda_Bastarda_9 } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const jacquardaBastarda = Jacquarda_Bastarda_9({
  variable: "--font-jacquarda-bastarda",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "BooksRus",
  description:
    "Search Hardcover books and preview covers from a simple in-browser app.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${jacquardaBastarda.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
