import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultRouteInterfaces, readNetwork } from "./network.js";

const HEADER = "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT";
const route = (iface: string, dest: string, metric: number) =>
  `${iface}\t${dest}\t0100A8C0\t0003\t0\t0\t${metric}\t00000000\t0\t0\t0`;

function fakeSys(files: Record<string, string>) {
  return { read: (p: string) => files[p] ?? null, exists: (p: string) => p in files };
}

describe("red del equipo", () => {
  it("elige la ruta por defecto de menor métrica", () => {
    const table = [HEADER, route("wlan0", "00000000", 600), route("eth0", "00000000", 100), route("eth0", "0000A8C0", 100)].join("\n");
    assert.deepEqual(defaultRouteInterfaces(table), ["eth0", "wlan0"]);
  });

  it("cable: interfaz sin carpeta wireless", () => {
    const sys = fakeSys({
      "/proc/net/route": [HEADER, route("eno1", "00000000", 100)].join("\n"),
      "/sys/class/net/eno1/operstate": "up\n",
    });
    assert.deepEqual(readNetwork(sys, "linux"), { type: "ethernet", iface: "eno1" });
  });

  it("wifi: interfaz con carpeta wireless", () => {
    const sys = fakeSys({
      "/proc/net/route": [HEADER, route("wlp2s0", "00000000", 600)].join("\n"),
      "/sys/class/net/wlp2s0/operstate": "up\n",
      "/sys/class/net/wlp2s0/wireless": "",
    });
    assert.deepEqual(readNetwork(sys, "linux"), { type: "wifi", iface: "wlp2s0" });
  });

  it("sin ruta por defecto o con la interfaz caída: sin red", () => {
    assert.equal(readNetwork(fakeSys({ "/proc/net/route": HEADER }), "linux").type, "none");
    const down = fakeSys({
      "/proc/net/route": [HEADER, route("eno1", "00000000", 100)].join("\n"),
      "/sys/class/net/eno1/operstate": "down\n",
    });
    assert.equal(readNetwork(down, "linux").type, "none");
  });

  it("cae al Wi-Fi si el cable está caído", () => {
    const sys = fakeSys({
      "/proc/net/route": [HEADER, route("eno1", "00000000", 100), route("wlan0", "00000000", 600)].join("\n"),
      "/sys/class/net/eno1/operstate": "down\n",
      "/sys/class/net/wlan0/operstate": "up\n",
      "/sys/class/net/wlan0/wireless": "",
    });
    assert.deepEqual(readNetwork(sys, "linux"), { type: "wifi", iface: "wlan0" });
  });

  it("fuera de Linux no se sabe", () => {
    assert.deepEqual(readNetwork(fakeSys({}), "win32"), { type: "unknown", iface: null });
  });
});
