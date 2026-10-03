import { describe, expect, it } from "vitest";
import { deriveAssumptionState, evidenceJustifies } from "@/lib/epistemics";
import { isValidStatus } from "@/lib/memory";

const sup = (strength: "anecdotal" | "moderate" | "strong" = "anecdotal") => ({ stance: "supports" as const, strength });
const weak = (strength: "anecdotal" | "moderate" | "strong" = "anecdotal") => ({ stance: "weakens" as const, strength });

describe("deriveAssumptionState", () => {
  it("no evidence means untested and low confidence", () => {
    expect(deriveAssumptionState([], "untested")).toEqual({ status: "untested", confidence: "low" });
  });

  it("one anecdote starts a test but is not support", () => {
    expect(deriveAssumptionState([sup()], "untested")).toEqual({ status: "testing", confidence: "low" });
  });

  it("enough supporting evidence becomes supported, never validated", () => {
    const many = [sup("moderate"), sup("moderate"), sup("moderate"), sup("moderate")];
    expect(deriveAssumptionState(many, "testing")).toEqual({ status: "supported", confidence: "high" });
  });

  it("weakening evidence outweighing support weakens the assumption", () => {
    expect(deriveAssumptionState([sup(), weak("moderate")], "testing").status).toBe("weakened");
  });

  it("mixed evidence is testing, and contested confidence never reads as high", () => {
    const r = deriveAssumptionState([sup("strong"), sup("strong"), weak()], "testing");
    expect(r.status).toBe("testing");
    expect(r.confidence).toBe("medium");
  });

  it("keeps a human-set validated/rejected status regardless of evidence", () => {
    expect(deriveAssumptionState([weak("strong")], "validated").status).toBe("validated");
    expect(deriveAssumptionState([], "rejected").status).toBe("rejected");
  });

  it("removing all evidence returns an auto status to untested", () => {
    expect(deriveAssumptionState([], "supported")).toEqual({ status: "untested", confidence: "low" });
  });
});

describe("evidenceJustifies", () => {
  it("requires substantial one-sided support to propose validated", () => {
    expect(evidenceJustifies([sup(), sup(), sup()], "validated")).toBe(false);
    expect(evidenceJustifies([sup("moderate"), sup("moderate"), sup("moderate")], "validated")).toBe(true);
    expect(evidenceJustifies([sup("strong"), sup("strong"), weak("strong")], "validated")).toBe(false);
  });
  it("requires real contrary evidence to propose rejected", () => {
    expect(evidenceJustifies([weak()], "rejected")).toBe(false);
    expect(evidenceJustifies([weak("moderate"), weak()], "rejected")).toBe(true);
  });
});

describe("status vocabularies", () => {
  it("are per kind", () => {
    expect(isValidStatus("assumption", "validated")).toBe(true);
    expect(isValidStatus("decision", "validated")).toBe(false);
    expect(isValidStatus("question", "open")).toBe(true);
  });
});
