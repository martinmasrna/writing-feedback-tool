import { createApp } from './app.js';

const app = createApp();

// Deep link: /?open=<abs path> loads the file straight in (served through the
// dev server's safelisted /open endpoint). Saving writes straight back to
// the same path through /save — no picker, the same as any editor that
// already knows where its file lives.
const target = new URLSearchParams(location.search).get('open');
if (target) app.openPath(target);
