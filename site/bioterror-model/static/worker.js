importScripts("./defaults.js", "./formulas.js", "./model.js");

self.onmessage = (event) => {
  const { id, payload } = event.data;
  try {
    const result = exportEnsemble(payload, (done, total) => {
      self.postMessage({ id, type: "progress", done, total });
    });
    self.postMessage({ id, type: "done", result });
  } catch (error) {
    self.postMessage({ id, type: "error", error: error.message || String(error) });
  }
};
