# Figma Asset Exporter

Export production-ready assets from a Figma file without manually selecting layers, renaming files, or rebuilding Android Nine-Patch resources.

The product combines a local web console, a background exporter, and an optional Figma plugin. Paste a Figma URL, review the detected file and export settings, choose an output directory, and start the job. The console keeps the process visible while assets are downloaded and post-processed.

## What You Get

- Every base node without children is exported automatically.
- The Figma page and node hierarchy is preserved as local directories.
- Existing assets are overwritten in place without deleting unrelated files.
- Every exported PNG is preserved as a regular image and can also produce a matching Android Nine-Patch file.
- Job progress, skipped assets, conversion fallbacks, and failures are shown in the console.
- The interface follows the system light or dark color scheme.

Example output:

```text
exports/
└── Components/
    └── Buttons/
        ├── primary_button.png
        └── primary_button.9.png
```

## Quick Start

Requirements:

- Node.js 20 or later
- A Figma personal access token with access to the target file
- ImageMagick or GraphicsMagick for Nine-Patch generation (optional)

Install and start the local console:

```shell
npm install
npm run app
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173), confirm the configuration, and start the export.

## Product Workflow

1. Paste a Figma `/design`, `/file`, `/proto`, `/board`, or `/slides` URL.
2. Confirm the automatically extracted `fileName` and `fileKey`.
3. Enter a personal access token or load it from `.env`.
4. Select the export format, scale, suffix, output directory, and Nine-Patch behavior.
5. Start the export and follow the background process from the job panel.
6. Use the generated files directly from the selected output directory.

The folder button opens the operating system directory picker. Submitted form values are passed only to the local background process and are not written back to `.env`.

## Configuration

Copy `.env.example` to `.env`:

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

| Variable             | Default     | Purpose                                            |
| -------------------- | ----------- | -------------------------------------------------- |
| `VITE_EXPORT_FORMAT` | `PNG`       | Export format: `PNG`, `JPG`, `SVG`, or `PDF`       |
| `VITE_EXPORT_SCALE`  | `1`         | Raster export scale from `0.01` to `4`             |
| `VITE_EXPORT_SUFFIX` | Empty       | Optional suffix added to exported file names       |
| `FIGMA_TOKEN`        | Empty       | Personal access token used by the local backend    |
| `FIGMA_URL`          | Empty       | Figma file URL displayed and parsed by the console |
| `FIGMA_FILE_KEY`     | Empty       | File key used when no full URL is configured       |
| `EXPORT_OUTPUT_DIR`  | `./exports` | Relative or absolute download directory            |
| `NINE_PATCH_ENABLED` | `true`      | Generate a `.9.png` variant for every PNG          |

Non-empty `.env` values are loaded into the corresponding form fields when the console starts. Configuration responses use `Cache-Control: no-store`, and `FIGMA_TOKEN` is never embedded in the frontend bundle.

## Nine-Patch Output

Nine-Patch generation is enabled by default. For every `button.png`, the exporter keeps the original file and creates `button.9.png` beside it.

Generated Nine-Patch files contain:

- A one-pixel transparent border
- A centered stretch marker on the top and left edges
- A full content area on the bottom and right edges

The exporter looks for these processors in order:

1. ImageMagick 7: `magick`
2. ImageMagick 6: `identify` and `convert`
3. GraphicsMagick: `gm`

If none is installed, Nine-Patch generation is skipped and the original assets remain available. A failed conversion affects only that image and does not fail the download job.

## Direct Export

To bypass the web console and use `.env` directly:

```shell
npm run download
```

## Figma Plugin

The optional plugin synchronizes export metadata inside the Figma file. It adds the configured export setting to base nodes and removes export settings from non-base nodes.

Build the project:

```shell
npm run build
```

In Figma Desktop, select `Plugins > Development > Import plugin from manifest...` and import `manifest.json` from this directory.

## Data and Safety

- The server listens only on `127.0.0.1`.
- Tokens are used by the local backend and are not included in compiled frontend assets.
- Existing files are overwritten only when their destination paths match generated assets.
- Existing directories are reused; unrelated files are never removed.
- Export and conversion commands are started without a shell.
