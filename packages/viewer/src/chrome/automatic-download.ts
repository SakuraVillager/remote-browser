import type { Down } from "@mirror/protocol";

type Download = Extract<Down, { t: "download" }>;

/** Start attachment navigation in the unsandboxed viewer, once per completed download. */
export function createAutomaticDownloads(document: Document) {
  const started = new Set<string>();
  return {
    handle(message: Download): boolean {
      if (started.has(message.id)) return true;
      if (message.state !== "done" || message.href === undefined) return false;
      const url = new URL(message.href, document.location.href);
      if (
        url.origin !== document.location.origin ||
        !/^\/s\/[^/]+\/d\/[A-Za-z0-9_-]+$/.test(url.pathname)
      )
        return false;
      const link = document.createElement("a");
      link.href = url.href;
      link.download = message.name;
      link.hidden = true;
      document.body.appendChild(link);
      try {
        link.click();
        started.add(message.id);
        return true;
      } catch {
        return false;
      } finally {
        link.remove();
      }
    },
  };
}
