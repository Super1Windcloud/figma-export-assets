# Figma Asset Exporter

Export production-ready assets from a Figma file without manually selecting layers, renaming files, or rebuilding Android Nine-Patch resources.

The product combines a local web console, a background exporter, a structured design contract, a separate Compose Generator, and an optional Figma plugin. Paste a Figma URL, review the detected file and export settings, choose an output directory, and start the job. The console keeps every stage visible while assets are downloaded and generated.

## What You Get

- Every visible, renderable `COMPONENT`, atomic image-fill layer, and explicitly marked graphic resource is exported. Repeated image layers with the same paint and render size are deduplicated. Raster image-fill layers use PNG/JPG while components and explicitly marked vector graphics can use SVG; page/layout frames and mixed-content groups are never flattened into combined assets.
- The Figma page and node hierarchy is preserved as local directories.
- Existing assets are overwritten in place. Files recorded by the previous manifest are removed when the new selection no longer includes them; unrelated files are never deleted.
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
4. Select one or more export formats, scale, suffix, output directory, and Nine-Patch behavior.
5. Enable manifest persistence, Compose generation, or both. These controls are independent.
6. Start the export and follow the background process from the job panel.
7. Use the generated files directly from the selected output directory.

The folder button opens the operating system directory picker. Submitted form values are passed only to the local background process and are not written back to `.env`.

While a job is running, use the stop button in the job panel to terminate the background process. The exporter first requests a graceful shutdown and forces termination if the process does not exit within three seconds. Files downloaded before cancellation are preserved.

## Configuration

Copy `.env.example` to `.env`:

```dotenv
VITE_EXPORT_FORMATS=PNG,SVG
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

| Variable                    | Default                 | Purpose                                             |
| --------------------------- | ----------------------- | --------------------------------------------------- |
| `VITE_EXPORT_FORMATS`       | `PNG,SVG`               | Comma-separated formats: `PNG`, `JPG`, `SVG`, `PDF` |
| `VITE_EXPORT_FORMAT`        | Empty                   | Legacy single-format fallback                       |
| `VITE_EXPORT_SCALE`         | `1`                     | Raster export scale from `0.01` to `4`              |
| `VITE_EXPORT_SUFFIX`        | Empty                   | Optional suffix added to exported file names        |
| `FIGMA_TOKEN`               | Empty                   | Personal access token used by the local backend     |
| `FIGMA_URL`                 | Empty                   | Figma file URL displayed and parsed by the console  |
| `FIGMA_FILE_KEY`            | Empty                   | File key used when no full URL is configured        |
| `EXPORT_OUTPUT_DIR`         | `./exports`             | Relative or absolute root download directory        |
| `NINE_PATCH_ENABLED`        | `true`                  | Generate a `.9.png` variant for every PNG           |
| `DESIGN_MANIFEST_ENABLED`   | `true`                  | Persist `design-manifest.json` in the file folder   |
| `COMPOSE_GENERATOR_ENABLED` | `false`                 | Generate an Android Compose library module          |
| `COMPOSE_MODULE_NAME`       | `figma-compose-ui`      | Generated module directory name                     |
| `COMPOSE_PACKAGE_NAME`      | `com.generated.figmaui` | Kotlin package and Android namespace                |

Non-empty `.env` values are loaded into the corresponding form fields when the console starts. Configuration responses use `Cache-Control: no-store`, and `FIGMA_TOKEN` is never embedded in the frontend bundle.

Each export creates or reuses one outer directory named after the Figma file under `EXPORT_OUTPUT_DIR`. Every page, node directory, original asset, and Nine-Patch variant for that file stays inside this directory.

## Design Manifest and Compose Generation

The exporter always constructs one in-memory manifest contract when either generation stage is enabled. The **Generate design manifest** switch controls whether that contract remains as `design-manifest.json`. The **Generate Compose module** switch starts a separate generator that reads the contract from a file. If Compose generation is enabled while manifest persistence is disabled, the exporter writes a temporary manifest, runs the generator, and removes only that temporary file afterward.

The manifest is the stable boundary between Figma extraction and platform generation. Schema v2 includes a complete `document` tree containing every page and descendant layer, independent of whether a node is exported as an asset. Node entries preserve identity, hierarchy, visibility, bounds, Auto Layout metadata, text, style references, paint/effect data, component references, and mask metadata such as `isMask` and `maskType`. Their `properties` object also retains every source API property not used by the tree identity fields, preventing less common or newly introduced Figma fields from being silently discarded. The `components` collection remains the component index used by the Compose generator, while `resources` records exported non-component base assets.

The generated Android library contains:

- A host-project-compatible `build.gradle.kts`
- Semantic component composables generated from the manifest layer tree
- `Row`, `Column`, and `Box` mappings for Auto Layout and free-positioned layers
- Text, solid fills, opacity, rounded corners, borders, sizing, spacing, and basic geometric masks
- Original PNG or JPG drawable resources and available Nine-Patch variants as explicit fallbacks
- A typed `FigmaComponent` enum
- Reusable `FigmaComponentUi`, `FigmaComponentImage`, and `FigmaComponentCatalog` composables
- An Android Studio preview

`FigmaComponentUi` is the default catalog renderer. `FigmaComponentImage` remains available when a caller explicitly needs the original raster reference. Complex vector geometry, gradient/image fills, arbitrary alpha masks, effects, fonts, interaction, accessibility semantics, and business state still require project-specific implementation; the generator does not silently replace those semantics with a raster image.

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

The optional plugin synchronizes export metadata inside the Figma file. Components, atomic image-fill layers, and explicitly marked graphic resources receive the configured format settings. Export settings are removed from page/layout frames and mixed-content groups so the plugin cannot flatten a composed screen into one asset.

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
