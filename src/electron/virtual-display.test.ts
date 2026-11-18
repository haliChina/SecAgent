import { test } from "node:test";
import assert from "node:assert/strict";

test("虚拟屏设备描述识别：VDD/GameViewer/Parsec 等特征命中", async () => {
  const { isVirtualDisplayDescription } = await import("./virtual-display-pure.js");
  assert.equal(isVirtualDisplayDescription("Virtual Display Driver"), true);
  assert.equal(isVirtualDisplayDescription("GameViewer Virtual Display Adapter"), true);
  assert.equal(isVirtualDisplayDescription("Parsec Virtual Display Adapter"), true);
  assert.equal(isVirtualDisplayDescription("DuetDisplay"), true);
  assert.equal(isVirtualDisplayDescription("spacedesk"), true);
  assert.equal(isVirtualDisplayDescription("Intel(R) UHD Graphics 630"), false);
  assert.equal(isVirtualDisplayDescription("NVIDIA GeForce RTX 4070"), false);
  assert.equal(isVirtualDisplayDescription("Generic PnP Monitor"), false);
});

test("设备描述解析：pnputil 输出切出 instance+description 对", async () => {
  const { parseEnumDevicesOutput } = await import("./virtual-display-pure.js");
  const stdout = [
    "Instance ID:                PCI\\VEN_10DE&DEV_1B80\\0",
    "Device Description:          NVIDIA GeForce RTX 4070",
    "    Status:                  Started",
    "",
    "Instance ID:                ROOT\\DISPLAY\\0000",
    "Device Description:          Virtual Display Driver",
    "    Status:                  Started",
  ].join("\r\n");
  const devices = parseEnumDevicesOutput(stdout);
  assert.equal(devices.length, 2);
  assert.equal(devices[1].description, "Virtual Display Driver");
  assert.match(devices[1].instanceId, /^ROOT/);
});

test("驱动清单解析：Published/Original Name 对应（卸载句柄）", async () => {
  const { parseEnumDriversOutput } = await import("./virtual-display-pure.js");
  const stdout = [
    "Published Name:     oem12.inf",
    "Original Name:      vdd.inf",
    "Provider Name:      Unknown",
    "Class Name:         Display",
    "Driver Version:     01/01/2026 1.0.0.0",
    "",
    "Published Name:     oem13.inf",
    "Original Name:      nvlt.inf",
    "Provider Name:      NVIDIA",
    "Class Name:         Display",
  ].join("\r\n");
  const drivers = parseEnumDriversOutput(stdout);
  assert.equal(drivers.length, 2);
  assert.equal(drivers[0].publishedName, "oem12.inf");
  assert.equal(drivers[0].originalName, "vdd.inf");
});

test("禁用/断开状态解析：Disabled 与 Disconnected 设备可被识别", async () => {
  const { parseEnumDevicesOutput } = await import("./virtual-display-pure.js");
  const stdout = [
    "Instance ID:                ROOT\SYSTEM\0001",
    "Device Description:          Virtual Display Driver",
    "    Status:                  Disabled",
    "",
    "Instance ID:                ROOT\SYSTEM\0002",
    "Device Description:          GameViewer Virtual Display Adapter",
    "    Status:                  Disconnected",
  ].join("\r\n");
  const devices = parseEnumDevicesOutput(stdout);
  assert.equal(devices.length, 2);
  assert.equal(devices[0].status, "Disabled");
  assert.equal(devices[1].status, "Disconnected");
});
