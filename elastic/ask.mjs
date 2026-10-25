// Ask the OpenTab Advisor agent a question (text) through the Agent Builder converse API, using Claude.
// Usage (repo root): node --env-file=.env.local elastic/ask.mjs "How much is a knee MRI with Kaiser?"
const kibana = process.env.KIBANA_URL.trim().replace(/\/+$/, "");
const question = process.argv.slice(2).join(" ") || "How much is a knee MRI in San Francisco with Blue Shield?";
const t0 = Date.now();
const res = await fetch(`${kibana}/api/agent_builder/converse`, {
  method: "POST",
  headers: { Authorization: `ApiKey ${process.env.ELASTIC_API_KEY.trim()}`, "Content-Type": "application/json", "kbn-xsrf": "true" },
  body: JSON.stringify({ input: question, agent_id: "opentab-advisor", inference_id: "opentab-claude" }),
});
const j = await res.json();
if (!res.ok) {
  console.error(`HTTP ${res.status}`, JSON.stringify(j).slice(0, 1000));
  process.exit(1);
}
console.log(`Q: ${question}\n`);
for (const step of j.steps ?? []) {
  if (step.type === "tool_call") console.log(`  [tool] ${step.tool_id} ${JSON.stringify(step.params)}`);
}
console.log(`\nA: ${j.response?.message ?? JSON.stringify(j).slice(0, 2000)}`);
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s, conversation ${j.conversation_id})`);
