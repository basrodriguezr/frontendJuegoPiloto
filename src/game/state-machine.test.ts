import { describe, expect, it } from "vitest";
import { createStateMachine } from "./state-machine";

describe("state machine", () => {
  it("tracks state and merges context", () => {
    const machine = createStateMachine("MENU");
    expect(machine.state).toBe("MENU");

    machine.transition("LOADING");
    expect(machine.state).toBe("LOADING");

    machine.transition("READY", { mode: "nivel1", packId: "pack-1" });
    expect(machine.state).toBe("READY");
    expect(machine.context.mode).toBe("nivel1");
    expect(machine.context.packId).toBe("pack-1");
  });
});
