import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatRemaining, renderBody } from "./home";

describe("formatRemaining", () => {
  it("shows a countdown rounded up to the next second", () => {
    expect(formatRemaining("1970-01-01T00:01:00.001Z", 0)).toBe(
      "あと1分01秒",
    );
  });

  it("clamps expired letters to zero", () => {
    expect(formatRemaining("1969-12-31T23:59:59.000Z", 0)).toBe(
      "あと0分00秒",
    );
  });

  it("labels returned letters", () => {
    expect(formatRemaining(null, 0)).toBe("返却済み");
  });
});

describe("renderBody", () => {
  it("renders registered emoji shortcodes as images and leaves unknown ones as text", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        renderBody("Hello :smile: :unknown:", [
          { code: "smile", label: "笑顔", file: "smile.webp" },
        ]),
      ),
    );

    expect(markup).toContain('alt=":smile:"');
    expect(markup).toContain('title="笑顔"');
    expect(markup).toContain("emojis/smile.webp");
    expect(markup).toContain("<span>:unknown:</span>");
  });
});
