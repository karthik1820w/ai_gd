import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyStatement } from "../src/server/scoring.ts";

const topic = "Impact of Artificial Intelligence on Education";
const description = "How AI changes teaching and learning";

describe("upgraded semantic + lexical classification", () => {
  it("classifies on-topic statements using semantic similarity as relevant", () => {
    const result = classifyStatement({
      topic,
      description,
      text: "Artificial software systems improve classroom education and learning outcomes for young pupils.",
    });

    assert.notEqual(result.relevance, "IRRELEVANT");
    assert.ok(result.relevance === "HIGHLY_RELEVANT" || result.relevance === "RELEVANT");
    assert.ok(result.knowledge > 40);
  });

  it("still rejects completely off-topic remarks with zero semantic relation", () => {
    const result = classifyStatement({
      topic,
      description,
      text: "The mechanics of high-pressure turbocharger turbines require synthetic oil lubrication.",
    });

    assert.equal(result.relevance, "IRRELEVANT");
  });

  it("identifies positive perspective and logic in semantically aligned statements", () => {
    const result = classifyStatement({
      topic,
      description,
      text: "Because artificial tutors can grade assessments efficiently, classroom education becomes much more interactive.",
    });

    assert.notEqual(result.relevance, "IRRELEVANT");
    assert.equal(result.positiveContribution, true);
    assert.equal(result.logicalArgument, true);
  });
});
