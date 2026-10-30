import type { TabId, TabMeta } from "@mirror/protocol";

/** Snapshots recover content; only tab metadata or the user's selection changes tabs. */
export function createTabSelection() {
  let current: TabId | null = null;
  let pending: TabId | null = null;
  return {
    get current() { return current; },
    select(tab: TabId) {
      current = tab;
      pending = tab;
    },
    snapshot(tab: TabId) {
      current ??= tab;
      return current;
    },
    update(tabs: readonly TabMeta[]) {
      const active = tabs.find(tab => tab.active);
      // Older metadata may already be in flight when a local tab is clicked.
      if (pending !== null && active?.id !== pending && tabs.some(tab => tab.id === pending)) {
        return current;
      }
      pending = null;
      if (active !== undefined) current = active.id;
      else if (!tabs.some(tab => tab.id === current)) current = tabs[0]?.id ?? null;
      return current;
    },
  };
}
