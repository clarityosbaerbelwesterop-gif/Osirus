import { Badge } from "../ui/badge";

export type ProviderRow = {
  id: string;
  label: string;
  envVar: string;
  configured: boolean;
  ok: boolean;
  models: number;
};

/** Which model providers have a key here, and how many chat models each lists. */
export function ProviderStatusTable({ rows }: { rows: ProviderRow[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Anbieter</th>
            <th scope="col">Status</th>
            <th scope="col">Modelle</th>
            <th scope="col">Variable</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.label}</td>
              <td>
                {!row.configured ? (
                  <Badge>Kein Key</Badge>
                ) : row.ok ? (
                  <Badge tone="success">Verbunden</Badge>
                ) : (
                  <Badge tone="warning">Liste nicht lesbar</Badge>
                )}
              </td>
              <td>{row.configured ? row.models : "–"}</td>
              <td>
                <code>{row.envVar}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
