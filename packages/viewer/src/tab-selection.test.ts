import { describe, expect, it } from "vitest";
import { createTabSelection } from "./tab-selection";

const tabs = (active: string) => [
  { id: "first", url: "https://first.test/", title: "First", active: active === "first" },
  { id: "second", url: "https://second.test/", title: "Second", active: active === "second" },
];

describe("interactive tab selection", () => {
  it("keeps the selected tab during background and reconnect snapshots", () => {
    const selection = createTabSelection();
    selection.update(tabs("second"));
    expect(selection.snapshot("first")).toBe("second");
    expect(selection.snapshot("second")).toBe("second");
  });
  it("ignores stale metadata until the user's selection is acknowledged", () => {
    const selection = createTabSelection();
    selection.update(tabs("first"));
    selection.select("second");
    expect(selection.update(tabs("first"))).toBe("second");
    expect(selection.snapshot("first")).toBe("second");
    expect(selection.update(tabs("second"))).toBe("second");
    expect(selection.update(tabs("first"))).toBe("first");
  });
  it("falls back when the selected tab is closed", () => {
    const selection = createTabSelection();
    selection.select("second");
    expect(selection.update(tabs("first").slice(0, 1))).toBe("first");
    expect(selection.update([])).toBeNull();
  });
});
