const queue: Promise<unknown>[] = [Promise.resolve()];

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const previous = queue[queue.length - 1] ?? Promise.resolve();
  const run = previous.then(task, task);
  queue.push(run.then(() => undefined, () => undefined));
  if (queue.length > 20) queue.splice(0, queue.length - 5);
  return run;
}

export function aiEnabled() {
  return Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY);
}

export function aiModel() {
  return process.env.AI_MODEL || "gpt-4o-mini";
}

export async function complete(system: string, user: string) {
  if (!aiEnabled()) return null;
  return enqueue(async () => {
    const base = process.env.AI_BASE_URL!.replace(/\/$/, "");
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: aiModel(),
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Language model request failed (${response.status}): ${detail.slice(0, 180)}`);
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "";
  });
}

export function parseJson(text: string) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Model did not return JSON");
  return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
}
