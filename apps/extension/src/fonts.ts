import { browser } from "wxt/browser";

function fontUrl(file: string): string {
  const path = `/fonts/${file}`;
  try {
    return browser.runtime.getURL(path as never);
  } catch {
    // Outside an extension context (tests, a bare page) there is no runtime; fall back to the plain path.
    return path;
  }
}

/**
 * Adds coPAYMe's two typefaces to the page once. @font-face declared on the document is visible
 * inside shadow roots, so every badge, card and popover can use "Archivo" and "JetBrains Mono".
 * Both files are variable fonts, so one file per family covers every weight we use.
 */
export function injectFonts(doc: Document = document): void {
  if (doc.head.querySelector("style[data-copayme-fonts]")) return;
  const style = doc.createElement("style");
  style.setAttribute("data-copayme-fonts", "");
  style.textContent = `
@font-face {
  font-family: "Archivo";
  font-style: normal;
  font-weight: 500 900;
  font-display: swap;
  src: url("${fontUrl("archivo.woff2")}") format("woff2");
}
@font-face {
  font-family: "JetBrains Mono";
  font-style: normal;
  font-weight: 500 700;
  font-display: swap;
  src: url("${fontUrl("jetbrains-mono.woff2")}") format("woff2");
}
`;
  doc.head.appendChild(style);
}
