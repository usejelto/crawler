/** Bundler guard: this package is server-only and must never reach a browser bundle. */
throw new TypeError('@jelto/crawler is server-only; it must not be imported into browser code (it carries a server-held jk_ key)')
