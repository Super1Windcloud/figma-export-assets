/// <reference types="vite/client" />
/// <reference types="@figma/plugin-typings" />

interface ImportMetaEnv {
  readonly VITE_EXPORT_FORMAT: 'PNG' | 'JPG' | 'SVG' | 'PDF';
  readonly VITE_EXPORT_FORMATS?: string;
  readonly VITE_EXPORT_SCALE: string;
  readonly VITE_EXPORT_SUFFIX: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
