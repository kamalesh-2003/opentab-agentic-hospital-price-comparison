import { Actor } from "apify";
import { ingest, type IngestInput } from "./ingest.js";

await Actor.init();

const input = ((await Actor.getInput()) ?? {}) as IngestInput;
if (!input.domain && !input.fileUrl && !input.hospitalName) {
  await Actor.fail("Provide hospitalName, domain, or fileUrl.");
}

const { summary, records } = await ingest(input, {
  onStage: async (stage, detail) => {
    console.log(`[${stage}] ${detail}`);
    await Actor.setStatusMessage(`${stage}: ${detail}`);
  },
});

for (let i = 0; i < records.length; i += 1000) {
  await Actor.pushData(records.slice(i, i + 1000));
}
await Actor.setValue("OUTPUT", summary);
console.log(JSON.stringify({ ...summary, log: undefined }, null, 2));

if (summary.status === "failed") await Actor.fail(summary.message);
else await Actor.exit(summary.message);
