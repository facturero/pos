import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { staleRemoteIds } from "./stale.js";

describe("staleRemoteIds", () => {
  it("devuelve los activos locales que el CRM ya no lista", () => {
    assert.deepEqual(staleRemoteIds(["a", "b", "c"], ["a", "c"]), ["b"]);
  });

  it("si el CRM sigue listándolos todos, no hay nada que desactivar", () => {
    assert.deepEqual(staleRemoteIds(["a", "b"], ["b", "a", "z"]), []);
  });

  it("si el CRM no devuelve ninguno, todos los locales quedan obsoletos", () => {
    assert.deepEqual(staleRemoteIds(["a", "b"], []), ["a", "b"]);
  });

  it("sin productos locales no hay nada que hacer", () => {
    assert.deepEqual(staleRemoteIds([], ["a"]), []);
  });

  it("conserva el orden de la lista local y no repite", () => {
    assert.deepEqual(staleRemoteIds(["c", "a", "b"], ["a"]), ["c", "b"]);
  });
});
