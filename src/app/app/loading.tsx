// Only the workspace streams a loading screen. Public pages (landing, legal,
// shared chats) render in one piece, so a missing page answers with a real
// 404 instead of a streamed 200.
export default function Loading() {
  return (
    <main className="status-page" aria-live="polite">
      <section className="status-card">
        <p className="overline">Osirus</p>
        <h1>Dein Workspace wird geladen …</h1>
      </section>
    </main>
  );
}
