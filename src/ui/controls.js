export function createControlsController() {
  const updateSegmented = (group) => {
    if (!group?.getClientRects().length) return;
    // Skip pressed buttons this layout hides, such as the phone-only research chips.
    const selected = [...group.querySelectorAll('button[aria-pressed="true"]')].find((button) => button.getClientRects().length);
    if (!selected) return;
    const bounds = selected.getBoundingClientRect();
    group.style.setProperty("--segment-left", `${bounds.left - group.getBoundingClientRect().left - group.clientLeft + group.scrollLeft}px`);
    group.style.setProperty("--segment-width", `${bounds.width}px`);
  };

  const updateSegmentedAll = () => {
    document.querySelectorAll(".segmented-control").forEach(updateSegmented);
  };

  const bind = () => {
    const segmentedResize = new ResizeObserver(updateSegmentedAll);
    document.querySelectorAll(".segmented-control").forEach((group) => segmentedResize.observe(group));
  };

  return { updateSegmented, updateSegmentedAll, bind };
}
