/**
 * Landing illustrations. Motion is CSS only (opacity and transform, 150–300 ms).
 */

export function BotStory() {
  return (
    <div
      className="story"
      role="region"
      aria-label="Beispiel eines Assistenten-Dialogs mit direkter Antwort und Verifikation."
    >
      <p className="story-kicker">Workspace-Dialog</p>
      <div className="story-msg" style={{ ["--d" as string]: "0ms" }}>
        <span className="story-who">Du</span>
        <span>Analysiere das Schema-Diff und prüfe die RLS-Policies.</span>
      </div>
      <div className="story-msg" style={{ ["--d" as string]: "90ms" }}>
        <span className="story-who">Assistenz</span>
        <span>Alle 3 Tabellen erzwingen FORCE ROW LEVEL SECURITY.</span>
      </div>
      <p className="story-typing" style={{ ["--d" as string]: "180ms" }}>
        <span className="story-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        Prüfermodell verifiziert…
      </p>
    </div>
  );
}

export function WorkStory() {
  return (
    <div
      className="story"
      role="region"
      aria-label="Ablauf eines Auftrags: planen, Modell wählen, getrenntes Prüfermodell und parallele Sub-Agents."
    >
      <p className="story-kicker">Orchestrierter Auftrag</p>
      <p className="story-prompt">Auftrag klassifizieren &amp; planen</p>
      <ul className="story-recs">
        <li style={{ ["--d" as string]: "40ms" }}>
          <span>Modell</span>
          <span className="story-badge">Empfohlen</span>
          <span>Ausführer</span>
        </li>
        <li style={{ ["--d" as string]: "110ms" }}>
          <span>Prüfer</span>
          <span className="story-badge">Empfohlen</span>
          <span>Unabhängig</span>
        </li>
        <li style={{ ["--d" as string]: "180ms" }}>
          <span>Sub-Agents</span>
          <span className="story-badge">Empfohlen</span>
          <span>Parallel</span>
        </li>
      </ul>
      <ol className="story-steps">
        <li data-state="done" style={{ ["--d" as string]: "40ms" }}>
          <span className="story-mark" aria-hidden="true" />
          Analyse &amp; Entwurf
        </li>
        <li data-state="run" style={{ ["--d" as string]: "110ms" }}>
          <span className="story-mark" aria-hidden="true" />
          Ausführung
        </li>
        <li data-state="wait" style={{ ["--d" as string]: "180ms" }}>
          <span className="story-mark" aria-hidden="true" />
          Prüfermodell
        </li>
      </ol>
      <p className="story-count">2/3 abgeschlossen</p>
      <details className="tool-card">
        <summary>
          <span>Verifikation</span>
          <span data-state="done">geprüft</span>
        </summary>
        <p>Deterministische Prüfung und unabhängiges Review bestanden.</p>
      </details>
    </div>
  );
}

export function AgentStory() {
  return (
    <ul
      className="story-agents"
      aria-label="Code: Repository verbinden, Änderung mit Tests prüfen, Pull Request öffnen."
    >
      {[
        { label: "Repository verbunden", badge: "Aktiv" },
        { label: "Änderung & Tests", badge: "Verifiziert" },
        { label: "Pull Request", badge: "Bereit" },
      ].map((item, index) => (
        <li key={item.label} style={{ ["--d" as string]: `${index * 70}ms` }}>
          <span>{item.label}</span>
          <span className="story-badge">{item.badge}</span>
        </li>
      ))}
    </ul>
  );
}
