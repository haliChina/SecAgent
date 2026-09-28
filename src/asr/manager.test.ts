import test from "node:test";
import assert from "node:assert/strict";
import { AsrManager } from "./manager.js";
import type { AsrEventSink, AsrProvider, AsrSession } from "./types.js";
import type { AsrProviderKind } from "./settings.js";

function fakeProvider(id: string, options: { configured?: boolean; failStart?: boolean } = {}): AsrProvider {
  return {
    id,
    label: `provider ${id}`,
    isConfigured: () => options.configured !== false,
    start: async (sink: AsrEventSink): Promise<AsrSession> => {
      if (options.failStart) throw new Error(`${id} cannot start`);
      return {
        providerId: id,
        push: () => {},
        stop: async () => { sink({ type: "stopped" }); },
        cancel: () => {}
      };
    }
  };
}

test("auto chain prefers third-party, then official, then local", () => {
  let kind: AsrProviderKind | undefined = "auto";
  const manager = new AsrManager({ getProviderKind: () => kind });
  manager.register(fakeProvider("openai"));
  manager.register(fakeProvider("official"));
  manager.register(fakeProvider("local"));
  assert.deepEqual(manager.chain(), ["openai", "official", "local"]);
  kind = "local";
  assert.deepEqual(manager.chain(), ["local"]);
  kind = "official";
  assert.deepEqual(manager.chain(), ["official", "local"]);
});

test("unconfigured providers are skipped unless they are the local fallback", () => {
  const manager = new AsrManager({ getProviderKind: () => "auto" });
  manager.register(fakeProvider("openai", { configured: false }));
  manager.register(fakeProvider("official", { configured: false }));
  manager.register(fakeProvider("local"));
  assert.deepEqual(manager.chain(), ["local"]);
});

test("start falls back when the preferred provider rejects", async () => {
  const manager = new AsrManager({ getProviderKind: () => "openai" });
  manager.register(fakeProvider("openai", { failStart: true }));
  const local = fakeProvider("local");
  manager.register(local);
  const started = await manager.start(() => {});
  assert.equal(started.providerId, "local");
  assert.deepEqual(started.fallbacks, ["openai"]);
  manager.cancel();
});

test("start resolves with the first working provider and records no fallbacks", async () => {
  const manager = new AsrManager({ getProviderKind: () => "auto" });
  manager.register(fakeProvider("openai"));
  manager.register(fakeProvider("local"));
  const started = await manager.start(() => {});
  assert.equal(started.providerId, "openai");
  assert.deepEqual(started.fallbacks, []);
  manager.cancel();
});

test("start rejects when every provider fails", async () => {
  const manager = new AsrManager({ getProviderKind: () => "auto" });
  manager.register(fakeProvider("openai", { failStart: true }));
  manager.register(fakeProvider("official", { failStart: true }));
  manager.register(fakeProvider("local", { failStart: true }));
  await assert.rejects(() => manager.start(() => {}), (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("openai：") && message.includes("official：") && message.includes("local：");
  });
});
