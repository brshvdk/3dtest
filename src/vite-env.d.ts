/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" — сборка для встраивания (страница на claude.ai): см. src/app/env.ts. */
  readonly VITE_EMBED?: string;
}
