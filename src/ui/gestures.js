export function bindInputMode(onChange) {
  const update = (mode) => { onChange(mode === "touch"); document.documentElement.dataset.inputMode = mode; };
  document.addEventListener("pointerdown", (event) => update(event.pointerType === "touch" ? "touch" : "pointer"), { capture: true, passive: true });
  document.addEventListener("touchstart", () => update("touch"), { capture: true, passive: true });
  document.addEventListener("keydown", () => update("keyboard"), true);
}

export function bindPullToRefresh(pullRefresh) {
  let gesture = null;
  let suppressClickUntil = 0;
  const canPull = (target) => {
    if (window.scrollY > 1 || document.scrollingElement.scrollTop > 1 || document.querySelector("dialog[open]") || !matchMedia("(max-width: 700px)").matches) return false;
    if (target.closest("input, select, textarea, [contenteditable]:not([contenteditable='false']), [role=slider]")) return false;
    for (let node = target; node && node !== document.scrollingElement; node = node.parentElement) {
      if (node.scrollTop > 1 && node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return false;
    }
    return true;
  };
  const reset = () => {
    gesture = null;
    pullRefresh.classList.remove("is-pulling", "is-ready", "is-refreshing");
    pullRefresh.style.removeProperty("--pull-distance");
    pullRefresh.lastChild.textContent = "下拉重新整理";
  };
  document.addEventListener("touchstart", (event) => {
    reset();
    const touch = event.touches[0];
    if (event.touches.length !== 1 || !touch || !canPull(event.target)) return;
    gesture = { x: touch.clientX, y: touch.clientY, distance: 0, target: event.target, active: false };
  }, { capture: true, passive: true });
  document.addEventListener("touchmove", (event) => {
    if (!gesture) return;
    if (event.touches.length !== 1 || !canPull(gesture.target)) { reset(); return; }
    const touch = event.touches[0];
    const vertical = touch.clientY - gesture.y;
    const horizontal = Math.abs(touch.clientX - gesture.x);
    if (!gesture.active) {
      if (Math.max(Math.abs(vertical), horizontal) < 8) return;
      if (vertical <= 0 || vertical <= horizontal) { reset(); return; }
      gesture.active = true;
    }
    if (!event.cancelable) { reset(); return; }
    event.preventDefault();
    suppressClickUntil = performance.now() + 400;
    gesture.distance = Math.max(0, Math.min(104, vertical * 0.55));
    pullRefresh.style.setProperty("--pull-distance", `${gesture.distance}px`);
    pullRefresh.classList.add("is-pulling");
    const ready = gesture.distance >= 68;
    pullRefresh.classList.toggle("is-ready", ready);
    pullRefresh.lastChild.textContent = ready ? "放開即可更新" : "下拉重新整理";
  }, { capture: true, passive: false });
  document.addEventListener("touchend", () => {
    if (!gesture) return;
    if (gesture.active) suppressClickUntil = performance.now() + 400;
    if (gesture.distance < 68 || !canPull(gesture.target)) { reset(); return; }
    pullRefresh.classList.remove("is-pulling", "is-ready");
    pullRefresh.classList.add("is-refreshing");
    pullRefresh.lastChild.textContent = "正在檢查版本並更新資料";
    gesture = null;
    const refreshEvent = new CustomEvent("stockapps:refresh", { cancelable: true });
    if (window.dispatchEvent(refreshEvent)) window.location.reload();
    else reset();
  }, { capture: true, passive: true });
  document.addEventListener("touchcancel", reset, { capture: true, passive: true });
  document.addEventListener("click", (event) => {
    if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
}

export function bindMobileDragDismiss(dialog, handle, { previewSelector, sheetQuery = "(max-width: 520px)" } = {}) {
  if (previewSelector) handle.setAttribute("aria-label", "關閉個股明細；下拉收合，再拉關閉，上拉展開");
  let drag = null;
  let suppressClickUntil = 0;
  const supportsPreview = () => previewSelector && dialog.querySelector(previewSelector) && matchMedia("(max-width: 520px)").matches;
  const setPreview = (preview) => {
    if (preview) dialog.dataset.mobileSheet = "preview";
    else delete dialog.dataset.mobileSheet;
    dialog.scrollTop = 0;
    if (preview && dialog.contains(document.activeElement) && !handle.contains(document.activeElement))
      handle.focus({ preventScroll: true });
  };
  const reset = () => { drag = null; dialog.classList.remove("is-dragging"); dialog.style.removeProperty("--mobile-drag-y"); };
  const canStart = (target) => {
    if (!dialog.open || dialog.hasAttribute("data-mandatory-update") || !matchMedia(sheetQuery).matches) return false;
    if (handle.contains(target)) return true;
    if (!handle.contains(target) && target.closest("button,a,input,select,textarea,summary,[role=slider],.table-scroll")) return false;
    for (let node = target; node && dialog.contains(node); node = node.parentElement)
      if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight + 1) return false;
    return true;
  };
  const move = (x, y, event) => {
    if (!drag) return;
    const distance = y - drag.y, horizontal = Math.abs(x - drag.x);
    const expanding = supportsPreview() && dialog.dataset.mobileSheet === "preview" && distance < 0;
    if ((!expanding && distance < -8) || horizontal > Math.max(8, Math.abs(distance))) { reset(); return; }
    if (Math.abs(distance) <= 8) return;
    event.preventDefault();
    drag.distance = distance;
    dialog.classList.add("is-dragging");
    dialog.style.setProperty("--mobile-drag-y", `${Math.max(-72, distance)}px`);
  };
  const finish = () => {
    if (!drag) return;
    const distance = drag.distance ?? 0;
    const closeDistance = Math.max(240, dialog.getBoundingClientRect().height * .65);
    if (Math.abs(distance) > 8) suppressClickUntil = performance.now() + 350;
    reset();
    if (distance <= -90 && supportsPreview()) setPreview(false);
    else if (distance >= 90) {
      if (supportsPreview() && dialog.dataset.mobileSheet !== "preview" && distance < closeDistance) setPreview(true);
      else dialog.close();
    }
  };
  dialog.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch" || event.button !== 0 || !canStart(event.target)) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.target.setPointerCapture(event.pointerId);
  });
  dialog.addEventListener("pointermove", (event) => {
    if (event.pointerId === drag?.id) move(event.clientX, event.clientY, event);
  });
  dialog.addEventListener("pointerup", (event) => { if (event.pointerId === drag?.id) finish(); });
  dialog.addEventListener("pointercancel", reset);
  dialog.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || !canStart(event.target)) { reset(); return; }
    const touch = event.touches[0];
    drag = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  dialog.addEventListener("touchmove", (event) => {
    if (event.touches.length !== 1) { reset(); return; }
    move(event.touches[0].clientX, event.touches[0].clientY, event);
  }, { passive: false });
  dialog.addEventListener("touchend", finish);
  dialog.addEventListener("touchcancel", reset);
  dialog.addEventListener("click", (event) => {
    if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  handle.addEventListener("click", () => { if (dialog.open && performance.now() >= suppressClickUntil) dialog.close(); });
  handle.addEventListener("keydown", (event) => {
    if (supportsPreview() && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "ArrowUp") setPreview(false);
      else if (dialog.dataset.mobileSheet === "preview") dialog.close();
      else setPreview(true);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener("close", () => { reset(); delete dialog.dataset.mobileSheet; suppressClickUntil = 0; });
}
