import { createRoot } from "react-dom/client";
import "@moritzbrantner/tables/table.css";
import "@moritzbrantner/charts/styles.css";
import "./site.css";

import { SiteApp } from "./site-app";
import type { PageId, ProjectPagesConfig } from "./types";

declare global {
  interface Window {
    __PROJECT_PAGES_CONFIG__?: ProjectPagesConfig;
    __PROJECT_PAGES_PAGE__?: PageId;
  }
}

const rootElement = document.querySelector<HTMLElement>("#site-app");
const config = window.__PROJECT_PAGES_CONFIG__;
const page = window.__PROJECT_PAGES_PAGE__;

if (rootElement && config && page) {
  createRoot(rootElement).render(<SiteApp config={config} page={page} />);
}
