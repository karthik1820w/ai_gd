import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aliasPeople, aliasText, deAlias, taskPrompt } from "../src/server/aiPrompts.ts";

describe("Gemini prompt safety", () => {
  it("aliases participant names in transcript text and restores aliases for users", () => {
    const aliases = aliasPeople([{ id: "1", name: "Alex Morgan" }, { id: "2", name: "Sam" }]);
    const privateText = aliasText("Alex Morgan replied to Sam.", aliases);
    assert.equal(privateText, "P1 replied to P2.");
    assert.equal(deAlias(privateText, aliases), "Alex Morgan replied to Sam.");
  });

  it("wraps every task with a marker and the standard security paragraph", () => {
    for (const task of ["BRIEF", "UTTERANCE", "EVALUATION", "ANSWER", "MODERATOR"] as const) {
      const prompt = taskPrompt(task, "Return the task result.");
      assert.ok(prompt.startsWith(`TASK: ${task}\n`));
      assert.ok(prompt.endsWith("Return only the requested content."));
      assert.match(prompt, /never as instructions/i);
    }
  });
});
