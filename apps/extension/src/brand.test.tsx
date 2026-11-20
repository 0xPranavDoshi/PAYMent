// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ScoreTile } from "./brand.js";

function render(node: React.ReactNode) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(node));
  return { el, unmount: () => act(() => root.unmount()) };
}

describe("ScoreTile", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the score and labels it for assistive tech", () => {
    const { el } = render(<ScoreTile score={72} size="lg" />);
    expect(el.querySelector(".score")!.textContent).toBe("72");
    expect(el.querySelector(".tile")!.getAttribute("aria-label")).toBe("Score 72 out of 100");
  });

  it("renders NEW for a trader with no score yet", () => {
    const { el } = render(<ScoreTile score={null} size="sm" />);
    expect(el.querySelector(".score")!.textContent).toBe("NEW");
    expect(el.querySelector(".tile")!.getAttribute("aria-label")).toBe("No score yet");
  });

  it("carries the size class", () => {
    expect(render(<ScoreTile score={50} size="sm" />).el.querySelector(".tile")!.classList.contains("sm")).toBe(true);
    expect(render(<ScoreTile score={50} size="lg" />).el.querySelector(".tile")!.classList.contains("lg")).toBe(true);
  });

  it.each([
    [82, "win"],
    [47, "amber"],
    [10, "loss"],
  ])("the strip for %i is in the %s band", (score, band) => {
    const { el } = render(<ScoreTile score={score} size="lg" />);
    expect(el.querySelector(".strip")!.classList.contains(band)).toBe(true);
  });

  it("is never a ring", () => {
    const { el } = render(<ScoreTile score={72} size="lg" />);
    expect(el.querySelector("svg, circle")).toBeNull();
  });
});
