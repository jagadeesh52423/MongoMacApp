/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOG_LEVEL?: 'error' | 'warn' | 'info' | 'debug';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
