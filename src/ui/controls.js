export function createControlsController() {
  // While a batch runs, groups are only collected; each is measured once when it ends.
  let pending = null;
  const updateSegmented = (group) => {
    if (pending) { if (group) pending.add(group); return; }
    if (!group?.getClientRects().length) return;
    // Skip pressed buttons this layout hides, such as the phone-only research chips.
    const selected = [...group.querySelectorAll('button[aria-pressed="true"]')].find((button) => button.getClientRects().length);
    if (!selected) return;
    const bounds = selected.getBoundingClientRect();
    const left = `${bounds.left - group.getBoundingClientRect().left - group.clientLeft + group.scrollLeft}px`;
    const previous = group.style.getPropertyValue("--segment-left");
    group.style.setProperty("--segment-left", left);
    group.style.setProperty("--segment-width", `${bounds.width}px`);
    // While the indicator travels to another option it is marked as moving, so styles
    // (the glass preview) can show it as a clear capsule that fills in on arrival.
    // is-switching lasts as long as the chosen option's pop, so that pop plays only when the choice
    // changes, never when a page holding the control is shown again.
    if (previous && selected !== movingFrom.get(group)) {
      if (previous !== left) {
        group.classList.add("is-moving");
        clearTimeout(movingTimers.get(group));
        movingTimers.set(group, setTimeout(() => group.classList.remove("is-moving"), 260));
      }
      group.classList.remove("is-switching");
      void group.offsetWidth; // restart the pop when choices follow each other quickly
      group.classList.add("is-switching");
      clearTimeout(switchTimers.get(group));
      switchTimers.set(group, setTimeout(() => group.classList.remove("is-switching"), 900));
    }
    movingFrom.set(group, selected);
  };
  const movingFrom = new WeakMap();
  const movingTimers = new WeakMap();
  const switchTimers = new WeakMap();

  const updateSegmentedAll = () => {
    document.querySelectorAll(".segmented-control").forEach(updateSegmented);
  };

  /** Runs `render`, deferring indicator measurement until all its DOM changes are done. */
  const batch = (render) => {
    if (pending) return render();
    pending = new Set();
    try { return render(); }
    finally {
      const groups = pending;
      pending = null;
      groups.forEach(updateSegmented);
    }
  };

  const bind = () => {
    const segmentedResize = new ResizeObserver(updateSegmentedAll);
    document.querySelectorAll(".segmented-control").forEach((group) => segmentedResize.observe(group));
  };

  return { updateSegmented, updateSegmentedAll, batch, bind };
}
