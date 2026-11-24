// The span maths is shared by the server (write time) and the editor (while the
// person types). It lives in src/lib so the browser bundle imports a UI module,
// not a server one; this file stays as the api-side name for it.
export * from '../../src/lib/attribution.js';
