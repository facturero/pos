import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseWifiList, splitTerseLine } from "./wifi.js";

describe("wifi: separar una línea terse de nmcli", () => {
  it("separa campos simples", () => {
    assert.deepEqual(splitTerseLine("*:MiRed:80:WPA2"), ["*", "MiRed", "80", "WPA2"]);
  });

  it("respeta un ':' escapado dentro de un campo (SSID con ':')", () => {
    assert.deepEqual(splitTerseLine(":Cafe\\:Centro:45:--"), ["", "Cafe:Centro", "45", "--"]);
  });

  it("respeta un '\\\\' escapado", () => {
    assert.deepEqual(splitTerseLine(":a\\\\b:10:--"), ["", "a\\b", "10", "--"]);
  });
});

describe("wifi: parsear la lista de redes", () => {
  it("marca segura la que trae WPA2/WPA3 y abierta la que trae '--'", () => {
    const out = [
      "*:CasaSegura:90:WPA2",
      ":CafeAbierto:60:--",
    ].join("\n");
    const nets = parseWifiList(out);
    assert.equal(nets.length, 2);
    assert.deepEqual(nets[0], { ssid: "CasaSegura", signal: 90, secured: true, active: true });
    assert.deepEqual(nets[1], { ssid: "CafeAbierto", signal: 60, secured: false, active: false });
  });

  it("descarta redes ocultas (SSID vacío)", () => {
    const out = [":: :30:WPA2", ":Real:50:WPA2"].join("\n");
    assert.deepEqual(parseWifiList(out).map((n) => n.ssid), ["Real"]);
  });

  it("un mismo SSID visto por dos antenas: se queda con la señal más fuerte", () => {
    const out = [":Oficina:40:WPA2", ":Oficina:75:WPA2"].join("\n");
    const nets = parseWifiList(out);
    assert.equal(nets.length, 1);
    assert.equal(nets[0].signal, 75);
  });

  it("ordena de mayor a menor señal", () => {
    const out = [":Debil:20:WPA2", ":Fuerte:95:WPA2", ":Media:50:WPA2"].join("\n");
    assert.deepEqual(parseWifiList(out).map((n) => n.ssid), ["Fuerte", "Media", "Debil"]);
  });

  it("líneas vacías no rompen el parseo", () => {
    const out = "\n:Real:50:WPA2\n\n";
    assert.deepEqual(parseWifiList(out).map((n) => n.ssid), ["Real"]);
  });
});
