// Note: MCP exposes tool ids with "." replaced by "_" (opentab.cash_prices -> opentab_cash_prices).
// Verify the OpenTab tools through Agent Builder's MCP server: list tools, then call two of them.
// Usage (elastic/): npm run mcp-check
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(`${process.env.KIBANA_URL.trim().replace(/\/+$/, "")}/api/agent_builder/mcp`);
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: { headers: { Authorization: `ApiKey ${process.env.ELASTIC_API_KEY.trim()}` } },
});
const client = new Client({ name: "opentab-mcp-check", version: "0.1.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const ours = tools.filter((t) => t.name.startsWith("opentab"));
console.log(`MCP server exposes ${tools.length} tools; OpenTab tools: ${ours.map((t) => t.name).join(", ")}`);

const show = (label, r) => {
  const text = r.content?.map((c) => c.text ?? "").join("\n") ?? "";
  console.log(`\n--- ${label}${r.isError ? " (ERROR)" : ""}\n${text.slice(0, 1500)}`);
};
show("lookup_procedure('having a baby')", await client.callTool({ name: "opentab_lookup_procedure", arguments: { text: "having a baby" } }));
show(
  "cash_prices('45378' colonoscopy)",
  await client.callTool({ name: "opentab_cash_prices", arguments: { code: "45378" } }),
);
await client.close();
