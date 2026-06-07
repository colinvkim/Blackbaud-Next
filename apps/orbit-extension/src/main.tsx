import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const host = document.getElementById("blackbaud-next-orbit-root");
const mount = host?.shadowRoot?.getElementById("blackbaud-next-orbit-app");

if (mount && mount.dataset.orbitMounted !== "1") {
  mount.dataset.orbitMounted = "1";
  createRoot(mount).render(<App />);
}
