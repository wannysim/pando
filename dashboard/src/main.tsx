import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createPandoApiClient } from "../../src/api/client";
import { DashboardApp } from "./App";

const apiBaseUrl = import.meta.env.VITE_PANDO_API_URL ?? window.location.origin;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardApp client={createPandoApiClient({ baseUrl: apiBaseUrl })} />
  </StrictMode>,
);
