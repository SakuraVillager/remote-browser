import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  const root = { on: vi.fn(), send: vi.fn(async () => ({})) };
  const browser = {
    target: () => ({ createCDPSession: async () => root }),
    close: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  };
  return { browser, connect: vi.fn(async () => browser) };
});
vi.mock("puppeteer-core", () => ({ connect: mock.connect, defaultArgs: vi.fn(), launch: vi.fn() }));
import { connectBrowser } from "./launch";

describe("external browser lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());
  it("disconnects an externally owned browser without closing its tabs", async () => {
    const browser = await connectBrowser("ws://browser/private", { disconnectOnClose: true });
    await browser.close();
    await browser.close();
    expect(mock.browser.disconnect).toHaveBeenCalledOnce();
    expect(mock.browser.close).not.toHaveBeenCalled();
  });
  it("retains explicit shutdown for callers that own the browser", async () => {
    const browser = await connectBrowser("ws://browser/private");
    await browser.close();
    expect(mock.browser.close).toHaveBeenCalledOnce();
    expect(mock.browser.disconnect).not.toHaveBeenCalled();
  });
});
