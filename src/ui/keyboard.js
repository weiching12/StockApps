export function bindKeyboardNavigation({ onSearch, onSectorDetails }) {
  document.addEventListener("keydown", (event) => {
    const sectorCard = event.target.closest?.("#sector-grid [data-sector-details]");
    if (sectorCard && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onSectorDetails(sectorCard.dataset.sectorDetails);
      return;
    }

    // "/" opens search from any page.
    if (event.key === "/" && !document.querySelector("dialog[open]") &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      onSearch();
    }
  });
}
