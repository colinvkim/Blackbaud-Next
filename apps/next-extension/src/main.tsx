import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const host = document.getElementById("blackbaud-next-root");
const mount = host?.shadowRoot?.getElementById("blackbaud-next-app");

if (mount && mount.dataset.nextMounted !== "1") {
  mount.dataset.nextMounted = "1";
  createRoot(mount).render(<App />);
}
