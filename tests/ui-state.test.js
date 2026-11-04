import test from "node:test";
import assert from "node:assert/strict";
import { createState } from "../src/ui/state.js";
import { loadPreferences, persistPreferences } from "../src/ui/preferences.js";

test("view state is isolated and saved preferences retain the existing migration", () => {
  const first = createState(), second = createState(); first.settings.period = 20;
  assert.equal(second.settings.period, 9);
  let saved = JSON.stringify({ favorites: ["2330"], settings: { period: 9, kSmooth: 3, dSmooth: 3 } });
  const storage = { getItem: () => saved, setItem: (key, value) => { saved = value; } };
  loadPreferences(second, storage);
  assert.deepEqual(second.favorites, ["2330", "3026", "6488"]);
  persistPreferences(second, () => assert.fail("unexpected toast"), storage);
  assert.equal(JSON.parse(saved).catalogVersion, 2);
  assert.equal(JSON.parse(saved).theme, "light");
});

test("dark theme preference is validated and persisted", () => {
  const state = createState();
  loadPreferences(state, { getItem: () => JSON.stringify({ favorites: [], settings: { period: 9, kSmooth: 3, dSmooth: 3 }, theme: "dark", catalogVersion: 2 }) });
  assert.equal(state.theme, "dark");
  let saved;
  persistPreferences(state, () => {}, { setItem: (_, value) => { saved = JSON.parse(value); } });
  assert.equal(saved.theme, "dark");
});

test("the market mood style is validated and persisted, defaulting to the gauge", () => {
  const loaded = (moodStyle) => {
    const state = createState();
    loadPreferences(state, { getItem: () => JSON.stringify({ favorites: [], moodStyle, catalogVersion: 2 }) });
    return state;
  };
  assert.equal(createState().moodStyle, "gauge");
  assert.equal(loaded("scale").moodStyle, "scale");
  assert.equal(loaded("rainbow").moodStyle, "gauge");
  assert.equal(loaded(undefined).moodStyle, "gauge");
  let saved;
  persistPreferences(loaded("scale"), () => {}, { setItem: (_, value) => { saved = JSON.parse(value); } });
  assert.equal(saved.moodStyle, "scale");
});

test("unavailable or malformed preference storage has a usable fallback", () => {
  for (const getItem of [() => "{", () => { throw new Error("blocked"); }]) {
    const state = createState(); loadPreferences(state, { getItem });
    assert.ok(state.favorites.includes("2330"));
  }
  let message;
  persistPreferences(createState(), (value) => { message = value; }, { setItem: () => { throw new Error("full"); } });
  assert.ok(message);
});
