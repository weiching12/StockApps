import { DEFAULT_SETTINGS } from "../../shared/indicators.js";
export const createState = () => ({
  date: "",
  page: "market",
  view: "all",
  sector: "all",
  query: "",
  sort: "",
  research: "all",
  sortDirection: -1,
  favorites: [],
  sectorWindow: "day",
  sectorSort: "activity-desc",
  sectorName: null,
  settings: { ...DEFAULT_SETTINGS },
  theme: "light",
});
