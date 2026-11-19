// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Gauge } from "./brand.js";

function render(node: React.ReactNode) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(node));
  return { el, unmount: () => act(() => root.unmount()) };
}

describe("Gauge", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("fills the ring in proportion to the score and counts the number up to it", async () => {
    const { el } = render(<Gauge score={72} />);
    const fill = el.querySelector<SVGCircleElement>(".fill")!;
    const circumference = 2 * Math.PI * 37;
    const [dash] = fill.getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(dash).toBeCloseTo(circumference * 0.72, 1);
    expect(fill.style.getPropertyValue("--dash")).toBe(`${dash}px`); // the animation fills to this
    await vi.waitFor(() => expect(el.querySelector(".score")!.textContent).toBe("72"));
    expect(el.querySelector(".cap")!.textContent).toBe("SCORE");
    expect(el.querySelector(".gauge")!.getAttribute("aria-label")).toBe("Score 72 out of 100");
  });

  it("never fills past the ring, whatever it is given", () => {
    const { el } = render(<Gauge score={250} />);
    const [dash] = el.querySelector(".fill")!.getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(dash).toBeCloseTo(2 * Math.PI * 37, 1);
  });

  it("shows an empty ring and NEW for a user with no score yet", () => {
    const { el } = render(<Gauge score={null} />);
    expect(el.querySelector(".fill")).toBeNull();
    expect(el.querySelector(".score")!.textContent).toBe("NEW");
    expect(el.querySelector(".gauge")!.getAttribute("aria-label")).toBe("No score yet");
  });

  it("shows the final score straight away when the user prefers reduced motion", () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduced-motion"), addEventListener() {}, removeEventListener() {} })) as never;
    const { el } = render(<Gauge score={72} />);
    expect(el.querySelector(".score")!.textContent).toBe("72");
    window.matchMedia = original;
  });
});
