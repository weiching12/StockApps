/**
 * Glass preview: the indicator guide gets a pinned header with a row of chapter
 * chips. A chip scrolls to its section; scrolling highlights the section in view.
 * Runs after every dialog render so a stale chip row never stays on another dialog.
 */
import { effectsReduced } from "./glass-mode.js";

let detachSpy = null;

export function enhanceGuideDialog(dialog, content) {
  detachSpy?.();
  detachSpy = null;
  dialog.querySelector(".guide-toc")?.remove();
  dialog.style.removeProperty("--guide-header");
  const sections = [...content.querySelectorAll(".guide-item")];
  if (!document.documentElement.classList.contains("glass-preview") || !sections.length) return;

  const toc = document.createElement("nav");
  toc.className = "guide-toc";
  toc.setAttribute("aria-label", "章節");
  sections.forEach((section, index) => {
    section.id ||= `guide-section-${index + 1}`;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = section.querySelector("h3")?.textContent ?? `第 ${index + 1} 節`;
    chip.dataset.target = section.id;
    toc.append(chip);
  });
  const header = dialog.querySelector(".dialog-top");
  header.append(toc);

  const headerOffset = () => header.getBoundingClientRect().bottom - dialog.getBoundingClientRect().top;
  // Sections scrolled to from elsewhere (table heading hints) clear the pinned header.
  dialog.style.setProperty("--guide-header", `${Math.round(headerOffset())}px`);
  toc.addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-target]");
    if (!chip) return;
    const section = content.querySelector(`#${chip.dataset.target}`);
    const top = section.getBoundingClientRect().top - dialog.getBoundingClientRect().top + dialog.scrollTop - headerOffset() + 4;
    dialog.scrollTo({ top, behavior: effectsReduced() ? "auto" : "smooth" });
  });

  const chips = [...toc.children];
  const markCurrent = () => {
    const line = dialog.getBoundingClientRect().top + headerOffset() + 24;
    const atEnd = dialog.scrollTop + dialog.clientHeight >= dialog.scrollHeight - 2;
    let current = 0;
    sections.forEach((section, index) => { if (section.getBoundingClientRect().top <= line) current = index; });
    if (atEnd) current = sections.length - 1;
    chips.forEach((chip, index) => {
      const active = index === current;
      chip.classList.toggle("active", active);
      if (active) chip.setAttribute("aria-current", "true");
      else chip.removeAttribute("aria-current");
    });
    // Scroll only the chip row; scrollIntoView would also nudge the dialog and cancel a smooth jump.
    const chip = chips[current];
    if (chip && (chip.offsetLeft < toc.scrollLeft || chip.offsetLeft + chip.offsetWidth > toc.scrollLeft + toc.clientWidth))
      toc.scrollTo({ left: chip.offsetLeft - 4 });
  };
  dialog.addEventListener("scroll", markCurrent, { passive: true });
  detachSpy = () => dialog.removeEventListener("scroll", markCurrent);
  markCurrent();
}
