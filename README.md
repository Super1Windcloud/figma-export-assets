# Figma Asset Exporter

This project includes a local export console and a Figma plugin. All application code is written in TypeScript:

- The web console parses `fileName` and `fileKey` from a Figma URL, then starts a background download process with the submitted configuration.
- The download process traverses every page, exports only base nodes without children, and preserves the Figma page and node directory hierarchy.
- The Figma plugin synchronizes `exportSettings` in the file: it adds an export setting to base nodes and removes export settings from non-base nodes.

## Configuration

Copy `.env.example` to `.env` and update the values as needed:

```dotenv
VITE_EXPORT_FORMAT=PNG
VITE_EXPORT_SCALE=1
VITE_EXPORT_SUFFIX=

FIGMA_TOKEN=
FIGMA_URL=
FIGMA_FILE_KEY=
EXPORT_OUTPUT_DIR=./exports
NINE_PATCH_ENABLED=true
```

`VITE_EXPORT_FORMAT` supports `PNG`, `JPG`, `SVG`, and `PDF`. `VITE_EXPORT_SCALE` applies only to `PNG` and `JPG` exports.

`EXPORT_OUTPUT_DIR` is the root download directory. Relative paths are resolved from the project directory; absolute paths are also supported. When the web console starts, non-empty URL, token, output directory, and export settings from `.env` are displayed in the corresponding form fields. `FIGMA_TOKEN` is not included in the frontend bundle, and the configuration API disables caching.

`NINE_PATCH_ENABLED` defaults to `true`. After downloading, every PNG is preserved and ImageMagick generates a matching Android Nine-Patch file beside it. For example, `button.png` produces `button.9.png`. The generated file uses a one-pixel transparent border, a centered stretch marker, and a full content area. Non-PNG exports are left unchanged.

## Web Console

```shell
npm install
npm run app
```

Open `http://127.0.0.1:4173` in a browser. Settings submitted through the console are passed to the local background process and are not written back to `.env`. The token is never included in the frontend bundle.

The interface follows the system light or dark color scheme. Use the folder button beside the download directory field to select a directory with the operating system file manager.

You can also download assets directly using the values in `.env`:

```shell
npm run download
```

## Figma Plugin

Run `npm run build`, then select `Plugins > Development > Import plugin from manifest...` in Figma Desktop and import `manifest.json` from this directory. When the plugin runs, it synchronizes export settings across the entire file.
