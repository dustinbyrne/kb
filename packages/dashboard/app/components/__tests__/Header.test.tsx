import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Header } from "../Header";

describe("Header", () => {
  it("renders a logo image with correct src and alt", () => {
    render(<Header />);
    const logo = screen.getByAltText("kb logo");
    expect(logo).toBeDefined();
    expect(logo.tagName).toBe("IMG");
    expect((logo as HTMLImageElement).src).toContain("/logo.svg");
  });

  it("renders the logo before the h1 element", () => {
    render(<Header />);
    const logo = screen.getByAltText("kb logo");
    const h1 = screen.getByRole("heading", { level: 1 });
    // Logo should be a preceding sibling of the h1
    expect(logo.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the settings button", () => {
    const onOpen = vi.fn();
    render(<Header onOpenSettings={onOpen} />);
    const btn = screen.getByTitle("Settings");
    expect(btn).toBeDefined();
  });
});
