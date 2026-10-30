import { describe, expect, it, vi } from "vitest";
import { createAutomaticDownloads } from "./automatic-download";

describe("local automatic downloads", () => {
  it("starts one local attachment navigation only after completion", () => {
    const click = vi.fn();
    const remove = vi.fn();
    const link = { click, remove };
    const document = {
      location: { href: "https://viewer.example/", origin: "https://viewer.example" },
      createElement: vi.fn(() => link),
      body: { appendChild: vi.fn() },
    } as unknown as Document;
    const downloads = createAutomaticDownloads(document);
    const message = {
      t: "download" as const,
      id: "one",
      name: "测试.txt",
      recv: 10,
      total: 10,
      state: "active" as const,
    };
    expect(downloads.handle(message)).toBe(false);
    const done = { ...message, state: "done" as const, href: "/s/session/d/key" };
    expect(downloads.handle(done)).toBe(true);
    expect(downloads.handle(done)).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(link).toMatchObject({
      download: "测试.txt",
      href: "https://viewer.example/s/session/d/key",
      hidden: true,
    });
  });

  it("does not navigate to a foreign origin or a non-download route", () => {
    const createElement = vi.fn();
    const document = {
      location: { href: "https://viewer.example/", origin: "https://viewer.example" },
      createElement,
    } as unknown as Document;
    const downloads = createAutomaticDownloads(document);
    for (const href of [
      "https://other.example/s/session/d/key",
      "/api/private",
      "javascript:alert(1)",
    ]) {
      expect(
        downloads.handle({
          t: "download",
          id: href,
          name: "file",
          recv: 1,
          total: 1,
          state: "done",
          href,
        }),
      ).toBe(false);
    }
    expect(createElement).not.toHaveBeenCalled();
  });
});
