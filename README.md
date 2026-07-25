# Figma Asset Exporter

Export production-ready assets from a Figma file without manually selecting layers, renaming files, or rebuilding Android Nine-Patch resources.

The product combines a local web console, a background exporter, a structured design contract, a separate Compose Generator, and an optional Figma plugin. Paste a Figma URL, review the detected file and export settings, choose an output directory, and start the job. The console keeps every stage visible while assets are downloaded and generated.

## What You Get

- Every `COMPONENT` node is exported, including variants and components that reuse nested instances.
- The Figma page and node hierarchy is preserved as local directories.
- Existing assets are overwritten in place without deleting unrelated files.
- Every exported PNG is preserved as a regular image and can also produce a matching Android Nine-Patch file.
- A versioned `design-manifest.json` records component identity, hierarchy, dimensions, layout metadata, variants, and exported asset paths.
- An independent Compose Generator can consume the manifest and create an image-backed Android library module with typed component mappings and previews.
- Job progress, skipped assets, conversion fallbacks, and failures are shown in the console.
- The interface follows the system light or dark color scheme.

Example output:

```text
exports/
└── Mobile Design System/
    ├── design-manifest.json
    ├── figma-compose-ui/
    │   ├── build.gradle.kts
    │   └── src/main/
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
5. Enable manifest persistence, Compose generation, or both. These controls are independent.
6. Start the export and follow the background process from the job panel.
7. Use the generated files directly from the selected output directory.

The folder button opens the operating system directory picker. Submitted form values are passed only to the local background process and are not written back to `.env`.

While a job is running, use the stop button in the job panel to terminate the background process. The exporter first requests a graceful shutdown and forces termination if the process does not exit within three seconds. Files downloaded before cancellation are preserved.

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
DESIGN_MANIFEST_ENABLED=true
COMPOSE_GENERATOR_ENABLED=false
COMPOSE_MODULE_NAME=figma-compose-ui
COMPOSE_PACKAGE_NAME=com.generated.figmaui
```

| Variable                    | Default                 | Purpose                                            |
| --------------------------- | ----------------------- | -------------------------------------------------- |
| `VITE_EXPORT_FORMAT`        | `PNG`                   | Export format: `PNG`, `JPG`, `SVG`, or `PDF`       |
| `VITE_EXPORT_SCALE`         | `1`                     | Raster export scale from `0.01` to `4`             |
| `VITE_EXPORT_SUFFIX`        | Empty                   | Optional suffix added to exported file names       |
| `FIGMA_TOKEN`               | Empty                   | Personal access token used by the local backend    |
| `FIGMA_URL`                 | Empty                   | Figma file URL displayed and parsed by the console |
| `FIGMA_FILE_KEY`            | Empty                   | File key used when no full URL is configured       |
| `EXPORT_OUTPUT_DIR`         | `./exports`             | Relative or absolute root download directory       |
| `NINE_PATCH_ENABLED`        | `true`                  | Generate a `.9.png` variant for every PNG          |
| `DESIGN_MANIFEST_ENABLED`   | `true`                  | Persist `design-manifest.json` in the file folder  |
| `COMPOSE_GENERATOR_ENABLED` | `false`                 | Generate an Android Compose library module         |
| `COMPOSE_MODULE_NAME`       | `figma-compose-ui`      | Generated module directory name                    |
| `COMPOSE_PACKAGE_NAME`      | `com.generated.figmaui` | Kotlin package and Android namespace               |

Non-empty `.env` values are loaded into the corresponding form fields when the console starts. Configuration responses use `Cache-Control: no-store`, and `FIGMA_TOKEN` is never embedded in the frontend bundle.

Each export creates or reuses one outer directory named after the Figma file under `EXPORT_OUTPUT_DIR`. Every page, node directory, original asset, and Nine-Patch variant for that file stays inside this directory.

## Design Manifest and Compose Generation

The exporter always constructs one in-memory manifest contract when either generation stage is enabled. The **Generate design manifest** switch controls whether that contract remains as `design-manifest.json`. The **Generate Compose module** switch starts a separate generator that reads the contract from a file. If Compose generation is enabled while manifest persistence is disabled, the exporter writes a temporary manifest, runs the generator, and removes only that temporary file afterward.

The manifest is the stable boundary between Figma extraction and platform generation. A component entry includes its node ID, Figma path, component-set membership, dimensions, Auto Layout metadata when available, variant properties, and relative asset paths. Consumers therefore do not need a Figma token or access to the original document.

The generated Android library contains:

- A host-project-compatible `build.gradle.kts`
- Original PNG or JPG drawable resources and available Nine-Patch variants
- A typed `FigmaComponent` enum
- Reusable `FigmaComponentImage` and `FigmaComponentCatalog` composables
- An Android Studio preview

This first generator is deliberately image-backed. It provides a complete resource component module without pretending that raster exports contain semantic layout, text, interaction, accessibility, or state information. The structured manifest is designed so a future semantic generator can use richer node data without changing the export pipeline.

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

To regenerate only the Android module from an existing manifest, without contacting Figma or downloading assets again:

```shell
npm run generate:compose -- "./exports/Mobile Design System/design-manifest.json"
```

The standalone generator reads `COMPOSE_MODULE_NAME` and `COMPOSE_PACKAGE_NAME` from `.env`. Set `COMPOSE_OUTPUT_DIR` to place the module somewhere other than beside the manifest.

## Figma Plugin

The optional plugin synchronizes export metadata inside the Figma file. Every node whose type is `COMPONENT` receives the configured export setting, including variants inside a component set and components that reuse nested instances. Primitive layers, instances, frames, groups, and component-set containers have their export settings removed.

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
