export function createControlsController() {
  const updateSegmented = (group) => {
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
    if (previous && previous !== left && selected !== movingFrom.get(group)) {
      group.classList.add("is-moving");
      clearTimeout(movingTimers.get(group));
      movingTimers.set(group, setTimeout(() => group.classList.remove("is-moving"), 260));
    }
    movingFrom.set(group, selected);
  };
  const movingFrom = new WeakMap();
  const movingTimers = new WeakMap();

  const updateSegmentedAll = () => {
    document.querySelectorAll(".segmented-control").forEach(updateSegmented);
  };

  const bind = () => {
    const segmentedResize = new ResizeObserver(updateSegmentedAll);
    document.querySelectorAll(".segmented-control").forEach((group) => segmentedResize.observe(group));
  };

  return { updateSegmented, updateSegmentedAll, bind };
}
