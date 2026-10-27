import { BotOrb } from "../bots/bot-orb";

/**
 * The landing's one product picture: a bot answering with sources beside
 * a step that waits for approval. Drawn in markup, not a screenshot; the
 * figure is described once for screen readers, its parts are decoration.
 */
export function ProductFrame() {
  return (
    <figure
      className="ln-frame"
      role="img"
      aria-label="Ein Bot namens Ada beantwortet eine Frage mit nummerierten Quellen; daneben wartet ein Pull Request auf deine Freigabe."
    >
      <div className="ln-frame-chat" aria-hidden="true">
        <div className="ln-frame-bot">
          <BotOrb seed="ada-landing" size={34} state="speaking" />
          <span className="ln-frame-name">Ada</span>
          <span className="ln-frame-role">Research Analyst</span>
        </div>
        <p className="ln-frame-ask">
          Wer sind unsere drei stärksten Wettbewerber, mit Quellen?
        </p>
        <div className="ln-frame-answer">
          <p>
            Drei Anbieter decken den Markt ab. Keiner verlangt vor
            Schreibzugriffen eine Freigabe <span className="ln-cite">[1]</span>{" "}
            <span className="ln-cite">[2]</span>.
          </p>
          <p className="ln-frame-sources">
            Quellen: [1] Produktseite · [2] Preisübersicht
          </p>
        </div>
      </div>
      <div className="ln-frame-side" aria-hidden="true">
        <p className="ln-overline">Wartet auf dich</p>
        <div className="ln-frame-approval">
          <p className="ln-frame-approval-title">Pull Request öffnen?</p>
          <p className="ln-frame-approval-meta">
            stats-lib · 3 Dateien geändert · Tests grün · vom Prüfermodell
            bestätigt
          </p>
          <div className="ln-frame-approval-actions">
            <span className="ln-pill ln-pill-light">Freigeben</span>
            <span className="ln-pill ln-pill-line">Ablehnen</span>
          </div>
        </div>
        <div className="ln-frame-team">
          <BotOrb seed="ada-landing" size={26} />
          <BotOrb seed="bea-landing" size={26} />
          <BotOrb seed="cleo-landing" size={26} />
          <span>Dein Team arbeitet mit</span>
        </div>
      </div>
    </figure>
  );
}
