import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coalesced } from "./coalesce.js";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe("coalesced", () => {
  it("sin avisos extra, corre una sola vez", async () => {
    let runs = 0;
    const trigger = coalesced(async () => {
      runs += 1;
      await tick();
    });
    await trigger();
    assert.equal(runs, 1);
  });

  it("un aviso mientras corre NO se pierde: corre una segunda vez al terminar", async () => {
    let runs = 0;
    const trigger = coalesced(async () => {
      runs += 1;
      await tick(20);
    });
    const first = trigger();
    await tick(5);
    void trigger(); // llega con el ciclo en marcha
    await first;
    assert.equal(runs, 2);
  });

  it("muchos avisos durante un ciclo se juntan en UNA repetición, no en una por aviso", async () => {
    let runs = 0;
    const trigger = coalesced(async () => {
      runs += 1;
      await tick(20);
    });
    const first = trigger();
    await tick(5);
    for (let i = 0; i < 10; i++) void trigger();
    await first;
    assert.equal(runs, 2);
  });

  it("nunca hay dos ejecuciones a la vez", async () => {
    let active = 0;
    let maxActive = 0;
    const trigger = coalesced(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick(10);
      active -= 1;
    });
    const first = trigger();
    await tick(2);
    void trigger();
    void trigger();
    await first;
    assert.equal(maxActive, 1);
  });

  it("un aviso que llega durante la REPETICIÓN también provoca otra repetición", async () => {
    let runs = 0;
    const trigger = coalesced(async () => {
      runs += 1;
      await tick(20);
    });
    const first = trigger();
    await tick(5);
    void trigger(); // durante la 1.ª ejecución
    await tick(25); // ya va por la 2.ª
    void trigger(); // durante la 2.ª
    await first;
    assert.equal(runs, 3);
  });

  it("llamadas separadas en el tiempo corren cada una", async () => {
    let runs = 0;
    const trigger = coalesced(async () => {
      runs += 1;
    });
    await trigger();
    await trigger();
    await trigger();
    assert.equal(runs, 3);
  });

  it("si run falla, se libera: un aviso posterior vuelve a correr", async () => {
    let runs = 0;
    const trigger = coalesced(async () => {
      runs += 1;
      if (runs === 1) throw new Error("falló");
    });
    await assert.rejects(trigger(), /falló/);
    await trigger();
    assert.equal(runs, 2);
  });
});
