import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/roboto/cyrillic-400.css";
import "@fontsource/roboto/cyrillic-500.css";
import "@fontsource/roboto/cyrillic-600.css";
import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-600.css";
import { App } from "./app/App.tsx";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
