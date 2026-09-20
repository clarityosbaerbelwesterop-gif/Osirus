export default function Home() {
  return (
    <main className="shell">
      <aside className="rail">
        <div className="brand">OSIRUS</div>
        <p className="muted">Workspace</p>
        <div className="section">
          <span className="pill">Foundation online</span>
        </div>
      </aside>
      <section className="chat">
        <header className="top">
          <strong>ChatHub</strong>{" "}
          <span className="muted">· event-driven workspace</span>
        </header>
        <div className="stream">
          <div className="hero">
            <h1>Build with an agent that remembers.</h1>
            <p className="muted">
              Plan, execute, verify and recover from durable checkpoints.
              Runtime events—not browser state—are the source of truth.
            </p>
          </div>
        </div>
        <form className="composer">
          <input aria-label="Message" placeholder="Give Osirus an objective…" />
          <button type="button">Run</button>
        </form>
      </section>
      <aside className="workbench">
        <strong>Workbench</strong>
        <div className="section">
          <p>Activity</p>
          <p className="muted">No active run</p>
        </div>
        <div className="section">
          <p>Plan</p>
          <p className="muted">Waiting for an objective</p>
        </div>
        <div className="section">
          <p>Artifacts</p>
          <p className="muted">No artifacts yet</p>
        </div>
        <div className="section">
          <p>Memory</p>
          <p className="muted">Context is private and tenant-scoped</p>
        </div>
      </aside>
    </main>
  );
}
