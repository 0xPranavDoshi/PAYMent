// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { injectFonts } from "./fonts.js";

describe("injectFonts", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("adds exactly one style element, however many times it runs", () => {
    injectFonts(document);
    injectFonts(document);
    expect(document.head.querySelectorAll("style[data-copayme-fonts]")).toHaveLength(1);
  });

  it("declares Archivo and JetBrains Mono", () => {
    injectFonts(document);
    const css = document.head.querySelector("style[data-copayme-fonts]")!.textContent!;
    expect(css).toContain('font-family: "Archivo"');
    expect(css).toContain('font-family: "JetBrains Mono"');
    expect(css).toContain("fonts/archivo.woff2");
  });
});
