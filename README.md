# Hot Wheels Catalog

A lightweight browser catalog for exploring Hot Wheels releases by year, built as a static site for GitHub Pages.

## Features

- Browse releases from 1968 to the current catalog range
- Search by model name, series, toy number, collector number and color
- Filter by year and series
- Garage and Wishlist stored locally in the browser
- Model details with source links
- IndexedDB caching for catalog responses
- Responsive mobile-first interface
- PWA shell and service worker
- No backend required

## Data source

The project uses the public MediaWiki API exposed by Hot Wheels Wiki/Fandom. The site does not include an official Mattel API and is not affiliated with Mattel.

Data availability and completeness depend on the upstream community-maintained source.

## Run locally

Use any static server, for example:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## GitHub Pages

Deploy the repository root from the `main` branch with GitHub Pages.

## Structure

- `index.html` — application shell
- `styles.css` — interface styles
- `app.js` — catalog loading, filtering, caching and collection logic
- `manifest.webmanifest` — PWA manifest
- `sw.js` — service worker
- `favicon.svg` / `icon.svg` — app icons
