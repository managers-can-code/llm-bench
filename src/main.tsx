import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

// React.StrictMode intentionally double-invokes effects in dev to surface
// race bugs. Our async listener registration was vulnerable to this in a way
// that double-emitted streamed chat tokens. Code is now race-safe (see
// pages/Chat.tsx), but we leave StrictMode off for now to match production
// behavior and keep dev predictable. Re-enable later when adding strict-mode
// audits.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
