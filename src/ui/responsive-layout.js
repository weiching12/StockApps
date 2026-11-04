export function bindResponsiveSearchOrder() {
  const phoneLayout = matchMedia("(max-width: 700px)");
  const searchControls = document.querySelector(".search-controls");
  const searchBox = document.querySelector(".search-box");
  // Phones show search above the filter row, so keyboard order must put it first too.
  const arrange = () => {
    const parent = phoneLayout.matches ? searchControls.parentElement : searchControls;
    if (parent.firstElementChild === searchBox) return;
    const focused = document.activeElement;
    parent.prepend(searchBox);
    if (searchBox.contains(focused)) focused.focus({ preventScroll: true });
  };
  arrange();
  phoneLayout.addEventListener("change", arrange);
}
