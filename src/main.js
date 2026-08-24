import { createApp } from './app.js';
import { fetchDocument } from './files.js';

const app = createApp();

// Deep link: /?open=<abs path> loads the file straight in (served through the
// dev server's safelisted /open endpoint). Saving is unchanged — the picker
// still decides where the annotated file lands.
const target = new URLSearchParams(location.search).get('open');
if (target) {
  fetchDocument(target).then((doc) => {
    if (doc) app.load(doc.text, doc.name, null);
  });
}
