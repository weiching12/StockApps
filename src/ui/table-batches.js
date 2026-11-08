export function createTableBatchController({ state, batchSize, render }) {
  // Phones scroll the rows inside the list, so "near the end" is measured against that box, not the window.
  const scroller = () => document.querySelector(".stocks-panel.is-fitted .table-scroll");
  const observe = () => {
    state.observer?.disconnect();
    if (state.fillFrame) cancelAnimationFrame(state.fillFrame);
    state.fillFrame = undefined;
    const trigger = document.querySelector("#table-load-trigger"), root = scroller();
    state.root = root;
    const fillViewport = () => {
      state.fillFrame = undefined;
      const bottom = root ? root.getBoundingClientRect().bottom : window.innerHeight;
      if (trigger.hidden || trigger.getBoundingClientRect().top > bottom + 600) return;
      state.visibleLimit += batchSize;
      render();
      if (!trigger.hidden) state.fillFrame = requestAnimationFrame(fillViewport);
    };
    state.observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || trigger.hidden) return;
      if (!state.fillFrame) state.fillFrame = requestAnimationFrame(fillViewport);
    }, { root, rootMargin: "600px 0px" });
    state.observer.observe(trigger);
  };
  // Switching between the phone and wider layouts changes which box scrolls.
  const sync = () => { if (state.root !== scroller()) observe(); };
  return { observe, sync };
}
