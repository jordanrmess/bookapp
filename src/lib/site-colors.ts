// The shared site colors live in playhtml, which only syncs after the page
// hydrates and connects. Each visitor caches the last colors they saw so the
// next load can paint with them immediately instead of the CSS default.
export const SITE_COLORS_STORAGE_KEY = "booksrus-site-colors";

// Runs in <head> before first paint (see app/layout.tsx).
export const APPLY_CACHED_SITE_COLORS_SCRIPT = `(function(){try{var c=JSON.parse(localStorage.getItem(${JSON.stringify(
  SITE_COLORS_STORAGE_KEY,
)}));var h=/^#[0-9a-f]{6}$/i;var s=document.documentElement.style;if(c&&h.test(c.background)){s.setProperty("--background",c.background);s.setProperty("--site-bg",c.background)}if(c&&h.test(c.text))s.setProperty("--foreground",c.text)}catch(e){}})()`;
