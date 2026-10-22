import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { aiDecisions, auditLog, buyingDecisions, emailOutbox, killEvents, lossEntries } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { ROLES } from "@/lib/auth/permissions";
import { ConsoleEmailProvider, deliverQueuedEmails, getEmailProvider, type EmailProvider } from "@/lib/email";
import { acknowledgeAlert, evaluateKill2AndAct, getKillStatus, rearmKill } from "@/lib/kill/service";
import { createLossEntry, listLossEntries, updateLossEntry } from "@/lib/workflow/losses";
import { fastRules } from "../helpers/ai";
import { count, createTestDb, newSeedRun, resetRunData, seedTestUsers, startSeedRun, type TestUsers } from "../helpers/workflow";
import { reviewDecision } from "@/lib/workflow/review";

let db: AnyDb;
let u: TestUsers;

// "Today" is in the October to December 2026 quarter unless a test moves it.
const Q4 = new Date("2026-10-23T11:00:00+05:30");
const Q1_NEXT = new Date("2027-01-05T11:00:00+05:30");

beforeAll(async () => {
  db = await createTestDb();
  u = await seedTestUsers(db);
});
beforeEach(() => resetRunData(db));

const entry = (over: Record<string, unknown> = {}) => ({
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  stockoutLossRupees: 0,
  overstockWriteoffRupees: 0,
  note: null,
  ...over,
});
const add = (body: Record<string, unknown>, now = Q4) => createLossEntry(db, u.priya, body, { now });
const states = async (now = Q4) => {
  const s = await getKillStatus(db, { now });
  return { kill2: s.kill2.state, total: s.kill2.loss.total };
};

describe("G. Kill 2: quarter-to-date loss against Rs 28L and Rs 34L (docs/10-TEST-PLAN.md table)", () => {
  it.each([
    [2_800_000, "green", false],
    [2_800_001, "alert", true],
    [3_400_000, "alert", true],
    [3_400_001, "killed", true],
  ] as const)("quarter-to-date loss Rs %i -> %s", async (total, state, eventExpected) => {
    const res = await add(entry({ stockoutLossRupees: total }));
    expect(res.kill2.state).toBe(state);
    expect((await states()).kill2).toBe(state);
    expect(await count(db, "kill_events")).toBe(eventExpected ? 1 : 0);
  });

  it("the stockout and overstock figures add together", async () => {
    await add(entry({ stockoutLossRupees: 1_800_000, overstockWriteoffRupees: 1_000_001 }));
    expect(await states()).toEqual({ kill2: "alert", total: 2_800_001 });
  });

  it("entries split across several records sum correctly", async () => {
    await add(entry({ periodStart: "2026-10-01", periodEnd: "2026-10-07", stockoutLossRupees: 900_000 }));
    await add(entry({ periodStart: "2026-10-08", periodEnd: "2026-10-14", stockoutLossRupees: 900_000, overstockWriteoffRupees: 100_000 }));
    expect(await states()).toEqual({ kill2: "green", total: 1_900_000 });
    await add(entry({ periodStart: "2026-10-15", periodEnd: "2026-10-31", overstockWriteoffRupees: 900_001 }));
    expect(await states()).toEqual({ kill2: "alert", total: 2_800_001 });
    expect((await getKillStatus(db, { now: Q4 })).kill2.loss.entries).toBe(3);
  });

  it("an entry in another quarter does not count toward this one", async () => {
    await add(entry({ periodStart: "2026-09-01", periodEnd: "2026-09-30", stockoutLossRupees: 9_000_000 })); // Q3
    await add(entry({ periodStart: "2027-01-01", periodEnd: "2027-01-31", stockoutLossRupees: 9_000_000 })); // Q1 of next year
    expect(await states()).toEqual({ kill2: "green", total: 0 });
    expect(await count(db, "kill_events")).toBe(0);
    await add(entry({ stockoutLossRupees: 100 }));
    expect((await states()).total).toBe(100);
  });

  it("the quarter edges are inclusive: 1 October and 31 December are in Q4, 30 September is not", async () => {
    await add(entry({ periodStart: "2026-09-30", periodEnd: "2026-09-30", stockoutLossRupees: 5 }));
    await add(entry({ periodStart: "2026-10-01", periodEnd: "2026-10-01", stockoutLossRupees: 10 }));
    await add(entry({ periodStart: "2026-12-31", periodEnd: "2026-12-31", stockoutLossRupees: 20 }));
    expect((await states()).total).toBe(30);
  });

  it("paise are exact: Rs 28,00,000.01 is an alert", async () => {
    const res = await add(entry({ stockoutLossRupees: 2_800_000.01 }));
    expect(res.kill2.state).toBe("alert");
  });

  it("takes both levels from config", async () => {
    const rules = fastRules((c) => {
      c.kill_switch_2.alert_above_rupees = 1000;
      c.kill_switch_2.kill_above_rupees = 2000;
    });
    expect((await createLossEntry(db, u.priya, entry({ periodStart: "2026-10-01", periodEnd: "2026-10-10", stockoutLossRupees: 1001 }), { rules, now: Q4 })).kill2.state).toBe("alert");
    expect((await createLossEntry(db, u.priya, entry({ periodStart: "2026-10-11", periodEnd: "2026-10-20", stockoutLossRupees: 1000 }), { rules, now: Q4 })).kill2.state).toBe("killed");
  });
});

describe("G. an alert: dashboard state, an event, and email to Raghav, Deepa and the CEO", () => {
  it("queues exactly one email each to Raghav, Deepa and the CEO, and none to anyone else", async () => {
    const res = await add(entry({ stockoutLossRupees: 2_900_000 }));
    expect(res.kill2).toMatchObject({ state: "alert", changed: true, total: 2_900_000 });
    const [event] = await db.select().from(killEvents);
    expect(event).toMatchObject({ killSwitch: 2, event: "alert", metricValue: 2_900_000, threshold: 2_800_000 });
    const mails = await db.select().from(emailOutbox);
    expect(mails.map((m) => m.toEmail).sort()).toEqual(["ceo@freshroots.test", "deepa@freshroots.test", "raghav@freshroots.test"]);
    expect(mails.every((m) => m.kind === "kill2.alert" && m.killEventId === event.id)).toBe(true);
    expect(mails[0].subject).toBe("Freshroots loss alert: monitor closely");
    expect(mails[0].body).toContain("Rs 29,00,000");
    expect(mails[0].body).toContain("Rs 29.00 lakh");
    expect(mails[0].body).toContain("Deepa reviews this weekly");
  });

  it("an alert does not stop the automation", async () => {
    await add(entry({ stockoutLossRupees: 3_000_000 }));
    expect((await getKillStatus(db, { now: Q4 })).stopped).toBe(false);
    await expect(startSeedRun(db, u.raghav)).resolves.toMatchObject({ flagCount: 7 });
  });

  it("staying in the alert band does not create more events or emails (idempotent)", async () => {
    await add(entry({ periodStart: "2026-10-01", periodEnd: "2026-10-10", stockoutLossRupees: 2_900_000 }));
    await add(entry({ periodStart: "2026-10-11", periodEnd: "2026-10-20", stockoutLossRupees: 100_000 }));
    await evaluateKill2AndAct(db, { now: Q4 });
    expect(await count(db, "kill_events")).toBe(1);
    expect(await count(db, "email_outbox")).toBe(3);
  });

  it("two evaluations at the same moment create one event", async () => {
    await db.insert(lossEntries).values({ periodStart: "2026-10-01", periodEnd: "2026-10-31", stockoutLossRupees: 3_000_000, overstockWriteoffRupees: 0, enteredBy: u.priya.id });
    await Promise.all([evaluateKill2AndAct(db, { now: Q4 }), evaluateKill2AndAct(db, { now: Q4 })]);
    await evaluateKill2AndAct(db, { now: Q4 });
    expect(await count(db, "kill_events")).toBe(1);
    expect(await count(db, "email_outbox")).toBe(3);
  });

  it("a correction that brings the total back down clears the alert, quietly but on the record", async () => {
    const created = await add(entry({ stockoutLossRupees: 2_900_000 }));
    const res = await updateLossEntry(db, u.priya, created.id, entry({ stockoutLossRupees: 2_000_000 }), { now: Q4 });
    expect(res.kill2).toMatchObject({ state: "green", changed: true });
    expect((await states()).kill2).toBe("green");
    expect(await count(db, "kill_events")).toBe(1); // no 'cleared' event, but an audit entry
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "kill2.cleared"))).toHaveLength(1);
  });
});

describe("G. Kill 2 fires above Rs 34L", () => {
  async function killViaTwoEntries() {
    await add(entry({ periodStart: "2026-10-01", periodEnd: "2026-10-15", stockoutLossRupees: 2_900_000 }));
    return add(entry({ periodStart: "2026-10-16", periodEnd: "2026-10-31", stockoutLossRupees: 600_000 })); // 35,00,000
  }

  it("the documented example: Rs 29,00,000 raises the alert, a further Rs 6,00,000 (35,00,000) kills", async () => {
    const first = await add(entry({ periodStart: "2026-10-01", periodEnd: "2026-10-15", stockoutLossRupees: 2_900_000 }));
    expect(first.kill2.state).toBe("alert");
    const second = await add(entry({ periodStart: "2026-10-16", periodEnd: "2026-10-31", stockoutLossRupees: 600_000 }));
    expect(second.kill2).toMatchObject({ state: "killed", total: 3_500_000 });
    const events = await db.select().from(killEvents).orderBy(killEvents.id);
    expect(events.map((e) => [e.killSwitch, e.event])).toEqual([[2, "alert"], [2, "killed"]]);
    expect(events[1]).toMatchObject({ metricValue: 3_500_000, threshold: 3_400_000 });
  });

  it("stops everything: new runs refused, unreviewed decisions voided, unplaced orders held, open runs blocked", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id });
    const decisionIds = (await db.select({ id: aiDecisions.id }).from(aiDecisions)).map((d) => d.id);
    await reviewDecision(db, u.raghav, { aiDecisionId: decisionIds[0], outcome: "accepted" });
    await killViaTwoEntries();
    const rows = await db.select({ s: aiDecisions.status }).from(aiDecisions);
    expect(rows.filter((r) => r.s === "voided_by_kill")).toHaveLength(6);
    expect((await db.select().from(buyingDecisions))[0].status).toBe("held");
    expect(run.runId).toBeGreaterThan(0);
    await expect(startSeedRun(db, u.raghav)).rejects.toMatchObject({ status: 409, code: "AUTOMATION_STOPPED", message: expect.stringContaining("Kill 2") });
    expect((await getKillStatus(db, { now: Q4 })).stoppedBy).toEqual([2]);
  });

  it("emails Raghav, Deepa, the CEO and Priya", async () => {
    await killViaTwoEntries();
    const killMails = (await db.select().from(emailOutbox)).filter((m) => m.kind === "kill2.killed");
    expect(killMails.map((m) => m.toEmail).sort()).toEqual(["ceo@freshroots.test", "deepa@freshroots.test", "priya@freshroots.test", "raghav@freshroots.test"]);
    expect(killMails[0].body).toContain("Automation stopped (Kill 2). Use the previous process.");
    expect(killMails[0].body).toContain("Rs 35,00,000");
  });

  it("Priya can keep entering losses while stopped, and the dashboard stays readable", async () => {
    await killViaTwoEntries();
    await expect(add(entry({ periodStart: "2026-12-01", periodEnd: "2026-12-31", stockoutLossRupees: 1 }))).resolves.toBeTruthy();
    expect((await getKillStatus(db, { now: Q4 })).kill2.loss.total).toBe(3_500_001);
  });

  it("a killed state survives a quarter rollover until it is re-armed", async () => {
    await killViaTwoEntries();
    await evaluateKill2AndAct(db, { now: Q1_NEXT }); // the daily check, in the new quarter with no losses yet
    const status = await getKillStatus(db, { now: Q1_NEXT });
    expect(status.kill2).toMatchObject({ state: "killed", band: "green" });
    expect(status.stopped).toBe(true);
    await expect(startSeedRun(db, u.raghav)).rejects.toMatchObject({ code: "AUTOMATION_STOPPED" });
  });

  it("an alert, unlike a kill, clears by itself when the quarter rolls over", async () => {
    await add(entry({ stockoutLossRupees: 3_000_000 }));
    expect((await states()).kill2).toBe("alert");
    const out = await evaluateKill2AndAct(db, { now: Q1_NEXT });
    expect(out).toMatchObject({ state: "green", changed: true, total: 0 });
    // And a new alert in the new quarter is a new event with new emails.
    await createLossEntry(db, u.priya, entry({ periodStart: "2027-01-01", periodEnd: "2027-01-31", stockoutLossRupees: 2_900_000 }), { now: Q1_NEXT });
    expect(await count(db, "kill_events")).toBe(2);
    expect(await count(db, "email_outbox")).toBe(6);
  });
});

describe("G. re-arming Kill 2", () => {
  const REASON = "Quarter reviewed with the CEO; continuing with care";
  async function killed() {
    await add(entry({ periodStart: "2026-10-01", periodEnd: "2026-10-15", stockoutLossRupees: 2_900_000 }));
    return add(entry({ periodStart: "2026-10-16", periodEnd: "2026-10-31", stockoutLossRupees: 600_000 }));
  }

  it("warns that it will fire again while the quarter is still above the kill level, and refuses without confirmation", async () => {
    await killed();
    const err = await rearmKill(db, u.deepa, { which: 2, reason: REASON }, { now: Q4 }).catch((e) => e);
    expect(err).toMatchObject({ status: 409, code: "REARM_WOULD_REFIRE" });
    expect(err.message).toContain("Rs 35,00,000");
    expect(err.details).toEqual({ total: 3_500_000, killAbove: 3_400_000 });
    expect((await getKillStatus(db, { now: Q4 })).kill2.state).toBe("killed");
    expect(await count(db, "kill_events")).toBe(2); // nothing new recorded
  });

  it("with confirmation it re-arms, keeps every loss entry, and fires again on the next evaluation", async () => {
    await killed();
    const res = await rearmKill(db, u.ceo, { which: 2, reason: REASON, confirmRefire: true }, { now: Q4 });
    expect(res).toMatchObject({ state: "alert", refireWarning: true });
    expect(await listLossEntries(db)).toHaveLength(2);
    expect((await getKillStatus(db, { now: Q4 })).stopped).toBe(false);
    const again = await evaluateKill2AndAct(db, { now: Q4 });
    expect(again).toMatchObject({ state: "killed", changed: true });
    const kinds = (await db.select().from(killEvents).orderBy(killEvents.id)).map((e) => e.event);
    expect(kinds).toEqual(["alert", "killed", "rearmed", "killed"]);
  });

  it("when the loss has been corrected down, re-arming needs no confirmation and stays armed", async () => {
    const second = await killed();
    await updateLossEntry(db, u.priya, second.id, entry({ periodStart: "2026-10-16", periodEnd: "2026-10-31", stockoutLossRupees: 100_000 }), { now: Q4 });
    expect((await getKillStatus(db, { now: Q4 })).kill2.state).toBe("killed"); // still stopped: a correction does not re-arm
    const res = await rearmKill(db, u.deepa, { which: 2, reason: REASON }, { now: Q4 });
    expect(res).toMatchObject({ state: "alert", refireWarning: false }); // 30,00,000 is in the alert band
    expect(await evaluateKill2AndAct(db, { now: Q4 })).toMatchObject({ state: "alert", changed: false });
    await expect(startSeedRun(db, u.raghav)).resolves.toBeTruthy();
  });

  it("re-arming in a new quarter lands on green", async () => {
    await killed();
    const res = await rearmKill(db, u.deepa, { which: 2, reason: REASON }, { now: Q1_NEXT });
    expect(res).toMatchObject({ state: "green", refireWarning: false });
  });

  it.each(ROLES.filter((r) => r !== "deepa" && r !== "ceo"))("%s cannot re-arm (403)", async (role) => {
    await killed();
    await expect(rearmKill(db, u[role], { which: 2, reason: REASON, confirmRefire: true }, { now: Q4 })).rejects.toMatchObject({ status: 403 });
  });

  it("a switch that is not stopped cannot be re-armed", async () => {
    await expect(rearmKill(db, u.deepa, { which: 2, reason: REASON }, { now: Q4 })).rejects.toMatchObject({ code: "NOT_KILLED" });
  });
});

describe("loss entries: who, what and how they are checked", () => {
  it.each(ROLES.filter((r) => r !== "priya"))("%s cannot enter losses (403)", async (role) => {
    await expect(createLossEntry(db, u[role], entry({ stockoutLossRupees: 1 }), { now: Q4 })).rejects.toMatchObject({ status: 403 });
    expect(await count(db, "loss_entries")).toBe(0);
  });

  it.each([
    [{ periodStart: "2026-10-31", periodEnd: "2026-10-01" }, "BAD_PERIOD"],
    [{ periodStart: "2026-13-01" }, "BAD_DATE"],
    [{ periodStart: "soon" }, "BAD_DATE"],
    [{ periodStart: "2026-09-15", periodEnd: "2026-10-15" }, "SPLIT_AT_QUARTER"],
    [{ periodStart: "2026-12-31", periodEnd: "2027-01-01" }, "SPLIT_AT_QUARTER"],
    [{ stockoutLossRupees: -1 }, "BAD_AMOUNT"],
    [{ stockoutLossRupees: "100" }, "BAD_AMOUNT"],
    [{ stockoutLossRupees: Number.NaN }, "BAD_AMOUNT"],
    [{ overstockWriteoffRupees: 1.005 }, "BAD_AMOUNT"],
    [{ overstockWriteoffRupees: 20_000_000_000 }, "BAD_AMOUNT"],
    [{ note: "x".repeat(501) }, "NOTE_TOO_LONG"],
  ])("rejects %j", async (over, code) => {
    await expect(add(entry(over))).rejects.toMatchObject({ status: 400, code });
    expect(await count(db, "loss_entries")).toBe(0);
  });

  it("a period that exists already is a 409; an overlapping one is saved but flagged for Priya to check", async () => {
    const first = await add(entry({ stockoutLossRupees: 100 }));
    await expect(add(entry({ stockoutLossRupees: 200 }))).rejects.toMatchObject({ status: 409, code: "DUPLICATE_PERIOD" });
    const overlap = await add(entry({ periodStart: "2026-10-10", periodEnd: "2026-10-20", stockoutLossRupees: 50 }));
    expect(overlap.overlaps).toEqual([first.id]);
    expect(first.overlaps).toEqual([]);
  });

  it("saves figures, who entered them, and the note, and audits it", async () => {
    const res = await add(entry({ stockoutLossRupees: 1234.5, overstockWriteoffRupees: 99.99, note: "  week 41 figures  " }));
    const [row] = await db.select().from(lossEntries).where(eq(lossEntries.id, res.id));
    expect(row).toMatchObject({ stockoutLossRupees: 1234.5, overstockWriteoffRupees: 99.99, note: "week 41 figures", enteredBy: u.priya.id });
    const [log] = await db.select().from(auditLog).where(eq(auditLog.action, "loss_entry.created"));
    expect(log.actorId).toBe(u.priya.id);
  });

  it("an edit keeps the before and after, records who and when, and checks Kill 2 again", async () => {
    const created = await add(entry({ stockoutLossRupees: 100 }));
    const res = await updateLossEntry(db, u.priya, created.id, entry({ stockoutLossRupees: 3_500_000, note: "corrected" }), { now: Q4 });
    expect(res.kill2.state).toBe("killed");
    const [row] = await db.select().from(lossEntries);
    expect(row).toMatchObject({ stockoutLossRupees: 3_500_000, updatedBy: u.priya.id });
    expect(row.updatedAt).toBeInstanceOf(Date);
    const [log] = await db.select().from(auditLog).where(eq(auditLog.action, "loss_entry.updated"));
    expect(log.beforeJson).toMatchObject({ stockoutLossRupees: 100 });
    expect(log.afterJson).toMatchObject({ stockoutLossRupees: 3_500_000, note: "corrected" });
    await expect(updateLossEntry(db, u.priya, 9999, entry(), { now: Q4 })).rejects.toMatchObject({ status: 404 });
    await expect(updateLossEntry(db, u.raghav, created.id, entry(), { now: Q4 })).rejects.toMatchObject({ status: 403 });
  });

  it("an edit cannot move an entry onto another entry's exact period", async () => {
    await add(entry({ periodStart: "2026-10-01", periodEnd: "2026-10-07" }));
    const b = await add(entry({ periodStart: "2026-10-08", periodEnd: "2026-10-14" }));
    await expect(updateLossEntry(db, u.priya, b.id, entry({ periodStart: "2026-10-01", periodEnd: "2026-10-07" }), { now: Q4 })).rejects.toMatchObject({ code: "DUPLICATE_PERIOD" });
  });
});

describe("G. the weekly acknowledgement during an alert", () => {
  it("Deepa acknowledges once per ISO week; the event and the audit log record who and when", async () => {
    await add(entry({ stockoutLossRupees: 3_000_000 }));
    expect((await getKillStatus(db, { now: Q4 })).needsAcknowledgement).toBe(true);
    const res = await acknowledgeAlert(db, u.deepa, { now: Q4 });
    expect(res.week).toBe("2026-W43");
    const [event] = await db.select().from(killEvents);
    expect(event.acknowledgedBy).toBe(u.deepa.id);
    expect(event.acknowledgedAt).toBeInstanceOf(Date);
    const status = await getKillStatus(db, { now: Q4 });
    expect(status.needsAcknowledgement).toBe(false);
    expect(status.lastAcknowledgement).toMatchObject({ week: "2026-W43", by: "Test deepa" });
    await expect(acknowledgeAlert(db, u.deepa, { now: Q4 })).rejects.toMatchObject({ status: 409, code: "ALREADY_ACKNOWLEDGED" });
    // The next week it is due again, and acknowledging again is allowed.
    const nextWeek = new Date("2026-10-30T11:00:00+05:30");
    expect((await getKillStatus(db, { now: nextWeek })).needsAcknowledgement).toBe(true);
    expect((await acknowledgeAlert(db, u.deepa, { now: nextWeek })).week).toBe("2026-W44");
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "alert.acknowledged"))).toHaveLength(2);
  });

  it("there must be an alert, and only Deepa acknowledges", async () => {
    await expect(acknowledgeAlert(db, u.deepa, { now: Q4 })).rejects.toMatchObject({ code: "NO_ALERT" });
    await add(entry({ stockoutLossRupees: 3_000_000 }));
    for (const role of ROLES.filter((r) => r !== "deepa")) {
      await expect(acknowledgeAlert(db, u[role], { now: Q4 })).rejects.toMatchObject({ status: 403 });
    }
  });
});

describe("kill events and the audit log are never edited or deleted (G-K4)", () => {
  async function eventExists() {
    await add(entry({ stockoutLossRupees: 3_000_000 }));
  }
  async function refused(statement: PromiseLike<unknown>) {
    const err = (await statement.then(() => null, (e: unknown) => e)) as (Error & { cause?: Error }) | null;
    expect(err, "the statement should have been refused").not.toBeNull();
    expect(String(err!.cause?.message ?? err!.message)).toMatch(/append-only/);
  }

  it("the database refuses to delete a kill event or change any of its facts", async () => {
    await eventExists();
    await refused(db.delete(killEvents));
    await refused(db.update(killEvents).set({ metricValue: 1 }));
    await refused(db.update(killEvents).set({ event: "rearmed" }));
    await refused(db.update(killEvents).set({ detailsJson: {} }));
    const [event] = await db.select().from(killEvents);
    expect(event.metricValue).toBe(3_000_000);
  });

  it("the only allowed change is recording a first acknowledgement, and only once", async () => {
    await eventExists();
    await expect(db.update(killEvents).set({ acknowledgedBy: u.deepa.id, acknowledgedAt: new Date() })).resolves.toBeDefined();
    await refused(db.update(killEvents).set({ acknowledgedBy: u.ceo.id }));
  });
});

describe("email delivery", () => {
  it("sends what is queued and marks it sent, and does nothing when the queue is empty", async () => {
    await add(entry({ stockoutLossRupees: 3_000_000 }));
    await db.update(emailOutbox).set({ status: "queued", sentAt: null });
    const sent: string[] = [];
    const provider: EmailProvider = { name: "test", send: async (m) => void sent.push(m.to) };
    expect(await deliverQueuedEmails(db, provider)).toEqual({ sent: 3, failed: 0 });
    expect(sent.sort()).toEqual(["ceo@freshroots.test", "deepa@freshroots.test", "raghav@freshroots.test"]);
    expect(await deliverQueuedEmails(db, provider)).toEqual({ sent: 0, failed: 0 });
  });

  it("a failing provider marks the row failed with a redacted reason and never blocks the switch", async () => {
    vi.stubEnv("EMAIL_API_KEY", "fake-email-key-0123456789");
    await add(entry({ stockoutLossRupees: 3_000_000 }));
    await db.update(emailOutbox).set({ status: "queued", sentAt: null });
    const provider: EmailProvider = { name: "bad", send: async () => { throw new Error("401 for key fake-email-key-0123456789"); } };
    expect(await deliverQueuedEmails(db, provider)).toEqual({ sent: 0, failed: 3 });
    const rows = await db.select().from(emailOutbox);
    expect(rows.every((r) => r.status === "failed" && r.error?.includes("[REDACTED]") && !r.error.includes("fake-email-key"))).toBe(true);
    vi.unstubAllEnvs();
  });

  it("the console provider logs who and the subject, never the body", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await new ConsoleEmailProvider().send({ to: "a@b.test", toName: "A", subject: "Subject line", body: "SECRET-BODY-TEXT" });
    expect(spy).toHaveBeenCalledWith('[email:console] to=a@b.test subject="Subject line"');
    expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRET-BODY-TEXT");
    spy.mockRestore();
  });

  it("a provider that is not built yet is refused clearly, and console is the default", () => {
    expect(getEmailProvider({}).name).toBe("console");
    expect(getEmailProvider({ EMAIL_PROVIDER: "console" }).name).toBe("console");
    expect(() => getEmailProvider({ EMAIL_PROVIDER: "sendgrid" })).toThrow(/not implemented/);
  });
});

describe("the whole flow of docs/10-TEST-PLAN.md step H, without the browser", () => {
  it("review, order, loss alert, kill, banner state, blocked run, re-arm, and an audit trail for every step", async () => {
    const run = await startSeedRun(db, u.raghav, { acknowledgeWarnings: true });
    expect(run.flagCount).toBe(7);
    const ids = (await db.select({ id: aiDecisions.id }).from(aiDecisions)).map((r) => r.id);
    for (const id of ids) await reviewDecision(db, u.raghav, { aiDecisionId: id, outcome: "accepted" });
    expect(await count(db, "buying_decisions")).toBe(7);

    const alert = await add(entry({ periodStart: "2026-10-01", periodEnd: "2026-10-15", stockoutLossRupees: 2_900_000 }));
    expect(alert.kill2.state).toBe("alert");
    const kill = await add(entry({ periodStart: "2026-10-16", periodEnd: "2026-10-31", stockoutLossRupees: 600_000 }));
    expect(kill.kill2.state).toBe("killed");
    const status = await getKillStatus(db, { now: Q4 });
    expect(status).toMatchObject({ stopped: true, stoppedBy: [2] });
    await expect(startSeedRun(db, u.raghav)).rejects.toMatchObject({ code: "AUTOMATION_STOPPED" });

    await rearmKill(db, u.deepa, { which: 2, reason: "Reviewed with the CEO; continuing with a close watch", confirmRefire: true }, { now: Q4 });
    const actions = new Set((await db.select().from(auditLog)).map((a) => a.action));
    for (const expected of ["snapshot.uploaded", "run.created", "run.ai_done", "review.accepted", "loss_entry.created", "kill2.alert", "kill2.fired", "kill.rearmed"]) {
      expect(actions, expected).toContain(expected);
    }
  });
});
