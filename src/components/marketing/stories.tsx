/**
 * Landing illustrations. They are examples, not live runs.
 * Motion is CSS only (opacity and transform, 150–300 ms).
 * Patterns follow assistant-ui (thread, typing) and Nexus UI
 * (reasoning, chain, tool row) without copying their source.
 */

export function BotStory() {
  return (
    <div
      className="story"
      role="region"
      aria-label="Beispiel eines Gruppenchats: zwei Nachrichten gleiten ein, ein Bot zeigt einen Tipp-Indikator. Eigene Bots und Gruppenchats sind bald verfügbar."
    >
      <p className="story-kicker">Beispiel, kein laufender Chat</p>
      <div className="story-msg" style={{ ["--d" as string]: "0ms" }}>
        <span className="story-who">Du</span>
        <span>Kurze Frage an den Assistenten.</span>
      </div>
      <div className="story-msg" style={{ ["--d" as string]: "90ms" }}>
        <span className="story-who">Assistenz</span>
        <span>Antwort, sobald sie wirklich eintrifft.</span>
      </div>
      <p className="story-typing" style={{ ["--d" as string]: "180ms" }}>
        <span className="story-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        Prüfung schreibt…
      </p>
    </div>
  );
}

export function WorkStory() {
  return (
    <div
      className="story"
      role="region"
      aria-label="Beispiel für Work: zuerst der Auftrag, dann Empfehlungen für Modell, Prüfer und Sub-Agents. Die Auswahl ist bald verfügbar."
    >
      <p className="story-kicker">Beispiel, keine laufende Aufgabe</p>
      <p className="story-prompt">Auftrag beschreiben</p>
      <ul className="story-recs">
        <li style={{ ["--d" as string]: "40ms" }}>
          <span>Modell</span>
          <span className="story-badge">Empfohlen</span>
          <span>Bald verfügbar</span>
        </li>
        <li style={{ ["--d" as string]: "110ms" }}>
          <span>Prüfer</span>
          <span className="story-badge">Empfohlen</span>
          <span>Bald verfügbar</span>
        </li>
        <li style={{ ["--d" as string]: "180ms" }}>
          <span>Sub-Agents</span>
          <span className="story-badge">Empfohlen</span>
          <span>Bald verfügbar</span>
        </li>
      </ul>
      <ol className="story-steps">
        <li data-state="done" style={{ ["--d" as string]: "40ms" }}>
          <span className="story-mark" aria-hidden="true" />
          Teilaufgabe
        </li>
        <li data-state="run" style={{ ["--d" as string]: "110ms" }}>
          <span className="story-mark" aria-hidden="true" />
          Teilaufgabe
        </li>
        <li data-state="wait" style={{ ["--d" as string]: "180ms" }}>
          <span className="story-mark" aria-hidden="true" />
          Prüfer
        </li>
      </ol>
      <p className="story-count">2/3 fertig</p>
      <details className="tool-card">
        <summary>
          <span>Werkzeug</span>
          <span data-state="done">fertig</span>
        </summary>
        <p>
          Beispielkarte. Ein echter Aufruf erscheint erst aus einem Ereignis.
        </p>
      </details>
      <details className="think" open>
        <summary>
          <span className="think-shimmer">Denkt nach…</span>
        </summary>
        <p>Gedacht 12 s steht hier nur als Form der Beispielanzeige.</p>
      </details>
    </div>
  );
}

export function AgentStory() {
  return (
    <ul
      className="story-agents"
      aria-label="Drei Beispielkarten für Agents. Anlegen, Deploy und Gruppenchat sind bald verfügbar."
    >
      {["Anlegen", "Deploy", "Gruppenchat"].map((label, index) => (
        <li key={label} style={{ ["--d" as string]: `${index * 70}ms` }}>
          <span>{label}</span>
          <span className="story-badge">Bald verfügbar</span>
        </li>
      ))}
    </ul>
  );
}
