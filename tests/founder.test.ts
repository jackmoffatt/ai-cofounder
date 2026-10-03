import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDb, type Db } from "@/db/client";
import { getEvent } from "@/db/queries/profile";
import {
  applyFounderCandidates,
  readFounder,
  saveFounderEdit,
  undoFounderEvent,
} from "@/services/memory/founder";

let db: Db;
const origin = { conversationId: "c1" };
beforeEach(() => {
  db = createDb(":memory:");
});

describe("applyFounderCandidates", () => {
  it("adds facts with their source quote and records an event", () => {
    const events = applyFounderCandidates(
      db,
      [{ field: "skills", value: "Python", evidence: "I write Python daily" }],
      origin,
    );
    expect(readFounder(db).profile.skills).toEqual(["Python"]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: "agent", reason: "I write Python daily", summary: "Skills: Python" });
  });

  it("skips duplicates, near-duplicates and blank values", () => {
    applyFounderCandidates(db, [{ field: "skills", value: "Python scripting", evidence: "e" }], origin);
    const events = applyFounderCandidates(
      db,
      [
        { field: "skills", value: "python Scripting.", evidence: "e" },
        { field: "skills", value: "Python", evidence: "e" },
        { field: "skills", value: "   ", evidence: "e" },
      ],
      origin,
    );
    expect(events).toHaveLength(0);
    expect(readFounder(db).profile.skills).toEqual(["Python scripting"]);
  });

  it("never overwrites an existing name and caps updates per turn", () => {
    applyFounderCandidates(db, [{ field: "name", value: "Jack", evidence: "I'm Jack" }], origin);
    const many = Array.from({ length: 9 }, (_, i) => ({ field: "interests" as const, value: `topic number ${i}`, evidence: "e" }));
    const events = applyFounderCandidates(db, [{ field: "name", value: "Other", evidence: "e" }, ...many], origin);
    expect(readFounder(db).name).toBe("Jack");
    expect(events.length).toBeLessThanOrEqual(5);
  });
});

describe("undo", () => {
  it("removes only the added item and leaves later edits alone", () => {
    const [ev] = applyFounderCandidates(db, [{ field: "skills", value: "Python", evidence: "e" }], origin);
    saveFounderEdit(db, { profile: { skills: ["Python", "Sales"] } });
    expect(undoFounderEvent(db, ev.id)).toBe("undone");
    expect(readFounder(db).profile.skills).toEqual(["Sales"]);
    expect(getEvent(db, ev.id)?.undoneAt).not.toBeNull();
    expect(undoFounderEvent(db, ev.id)).toBe("already_undone");
  });

  it("undoes a name and refuses user-made events", () => {
    const [ev] = applyFounderCandidates(db, [{ field: "name", value: "Jack", evidence: "e" }], origin);
    expect(undoFounderEvent(db, ev.id)).toBe("undone");
    expect(readFounder(db).name).toBeNull();
    expect(undoFounderEvent(db, "missing")).toBe("not_found");
  });
});

describe("saveFounderEdit", () => {
  it("replaces fields, trims blanks and logs a user event only when something changed", () => {
    saveFounderEdit(db, { name: " Jack ", profile: { goals: [" ship an MVP ", ""] } });
    expect(readFounder(db)).toMatchObject({ name: "Jack", profile: { goals: ["ship an MVP"] } });
    const before = JSON.stringify(readFounder(db));
    saveFounderEdit(db, { profile: { goals: ["ship an MVP"] } });
    expect(JSON.stringify(readFounder(db))).toBe(before);
  });
});
