import type { ReactNode } from "react";
import { cx } from "../ui/cx";
import { TopBar } from "./top-bar";

/** Scaffolding for product pages other than the chat: top bar, heading, body. */
export function PageFrame({
  title,
  lede,
  actions,
  narrow = false,
  children,
}: {
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <TopBar title={title} titleAs="p" />
      <div className="page-scroll">
        <div className={cx("page-inner", narrow && "page-narrow")}>
          <header className="page-header">
            <div>
              <h1 className="page-title">{title}</h1>
              {lede ? <p className="page-lede">{lede}</p> : null}
            </div>
            {actions ? <div className="row row-wrap">{actions}</div> : null}
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}
