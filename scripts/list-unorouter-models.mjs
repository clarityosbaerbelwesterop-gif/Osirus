// Print the models the configured UnoRouter key can use, with whatever
// pricing the API reports, so a model for the live evals is chosen from the
// real list rather than guessed. Never prints the key.

const key = process.env.UNOROUTER_API_KEY_1;
if (!key) throw new Error("UNOROUTER_API_KEY_1 is not set");

const response = await fetch("https://api.unorouter.com/v1/models", {
  headers: { Authorization: `Bearer ${key}` },
});
if (!response.ok) throw new Error(`models request failed (${response.status})`);
const body = await response.json();
const models = Array.isArray(body.data) ? body.data : [];

const priceOf = (model) => {
  const pricing = model?.pricing ?? model?.price ?? {};
  const input = Number(
    pricing.prompt ?? pricing.input ?? pricing.input_cost ?? NaN,
  );
  const output = Number(
    pricing.completion ?? pricing.output ?? pricing.output_cost ?? NaN,
  );
  return { input, output };
};

const rows = models
  .filter((model) => typeof model?.id === "string")
  .map((model) => {
    const { input, output } = priceOf(model);
    const free =
      /:free$|(^|[-_/])free([-_/]|$)/i.test(model.id) ||
      model?.free === true ||
      (input === 0 && output === 0);
    return {
      id: model.id,
      free,
      input,
      output,
      keys: Object.keys(model).join(","),
    };
  })
  .sort((a, b) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id));

console.log(
  `models: ${rows.length}; free: ${rows.filter((row) => row.free).length}`,
);
for (const row of rows)
  console.log(
    `${row.free ? "FREE " : "     "}${row.id}  input=${Number.isNaN(row.input) ? "?" : row.input} output=${Number.isNaN(row.output) ? "?" : row.output}`,
  );
if (rows[0]) console.log(`fields on a model record: ${rows[0].keys}`);
