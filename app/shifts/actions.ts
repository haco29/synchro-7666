"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireLinkedMember } from "@/lib/auth";
import { listOrgMembers } from "@/lib/clerk/members";
import {
  addPerson,
  historyBefore,
  isPersonActive,
  linkPersonToUser,
  listConstraintsForWeek,
  listPeople,
  removeAssignment,
  renamePerson,
  replaceWeekAssignments,
  setPersonActive,
  setUnavailable,
  setUnavailableShift,
  setWeekUnavailable,
  swapSeat,
  unlinkPerson,
} from "@/lib/db/queries";
import { generateWeek } from "@/lib/scheduler/generate";
import type { ShiftType, SlotType } from "@/lib/shifts/types";
import { SHIFT_TYPES, SLOT_TYPES } from "@/lib/shifts/types";
import { isIsoDate, weekStartOf } from "@/lib/shifts/week";

// Server Actions are directly POSTable, so every input is validated here —
// the forms rendering them are not a trust boundary.

function requireDate(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !isIsoDate(value)) {
    throw new Error(`Invalid date: ${String(value)}`);
  }
  return value;
}

function requireId(value: FormDataEntryValue | null): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid id: ${String(value)}`);
  }
  return id;
}

function requireSlot(value: FormDataEntryValue | null): SlotType {
  const slot = String(value) as SlotType;
  if (!SLOT_TYPES.includes(slot)) {
    throw new Error(`Invalid slot: ${String(value)}`);
  }
  return slot;
}

/** Availability is per time-shift only — kitchen/backup are never shift-blocked. */
function requireShift(value: FormDataEntryValue | null): ShiftType {
  const shift = String(value) as ShiftType;
  if (!SHIFT_TYPES.includes(shift)) {
    throw new Error(`Invalid shift: ${String(value)}`);
  }
  return shift;
}

/** A canonical week-start: the date must be the Thursday that anchors its week. */
function requireWeekStart(value: FormDataEntryValue | null): string {
  const weekStart = requireDate(value);
  if (weekStartOf(weekStart) !== weekStart) {
    throw new Error(`${weekStart} is not a canonical week start`);
  }
  return weekStart;
}

/** A date plus the week-start (Thursday) of the week it must belong to. */
function requireWeekDate(
  weekValue: FormDataEntryValue | null,
  dateValue: FormDataEntryValue | null,
): { weekStart: string; date: string } {
  const weekStart = requireDate(weekValue);
  const date = requireDate(dateValue);
  if (weekStartOf(date) !== weekStart) {
    throw new Error(`Date ${date} is not in the week of ${weekStart}`);
  }
  return { weekStart, date };
}

// ---- roster ----

export async function addPersonAction(formData: FormData) {
  const { teamId } = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (name) await addPerson(teamId, name);
  revalidatePath("/shifts", "layout");
}

export async function renamePersonAction(formData: FormData) {
  const { teamId } = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (name) await renamePerson(teamId, requireId(formData.get("personId")), name);
  revalidatePath("/shifts", "layout");
}

export async function setPersonActiveAction(formData: FormData) {
  const { teamId } = await requireAdmin();
  await setPersonActive(teamId, requireId(formData.get("personId")), formData.get("active") === "1");
  revalidatePath("/shifts", "layout");
}

// ---- person ↔ Clerk user linking (admin only) ----

function requireNonEmpty(value: FormDataEntryValue | null, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return value.trim();
}

export async function linkPersonAction(formData: FormData) {
  const { teamId } = await requireAdmin();
  const personId = requireId(formData.get("personId"));
  const clerkUserId = requireNonEmpty(formData.get("clerkUserId"), "clerkUserId");
  // The dropdown lists only org members, but the action is POST-reachable — so
  // verify the id really belongs to the caller's org before linking.
  const members = await listOrgMembers();
  if (!members.some((m) => m.userId === clerkUserId)) {
    throw new Error("clerkUserId is not a member of this organization");
  }
  await linkPersonToUser(teamId, personId, clerkUserId);
  revalidatePath("/shifts", "layout");
}

export async function unlinkPersonAction(formData: FormData) {
  const { teamId } = await requireAdmin();
  await unlinkPerson(teamId, requireId(formData.get("personId")));
  revalidatePath("/shifts", "layout");
}

// ---- unavailability ----

export async function toggleUnavailableAction(formData: FormData) {
  const { teamId } = await requireAdmin();
  await setUnavailable(
    teamId,
    requireId(formData.get("personId")),
    requireDate(formData.get("date")),
    formData.get("unavailable") === "1",
  );
  revalidatePath("/shifts", "layout");
}

/**
 * Resolve the caller's own person for a self-service availability edit (ADR-0003).
 * Identity is derived server-side (`requireLinkedMember`); the form's `personId`
 * is accepted only if it matches — a spoofed id is rejected, never trusted.
 * Inactive members are refused here too: the UI disables it, but the action is
 * POST-reachable. Unlinked members are refused (`requireLinkedMember` throws).
 */
async function requireOwnEditablePerson(
  formData: FormData,
): Promise<{ teamId: number; personId: number }> {
  const { teamId, personId } = await requireLinkedMember();
  if (requireId(formData.get("personId")) !== personId) {
    throw new Error("Cannot edit another person's availability");
  }
  if (!(await isPersonActive(teamId, personId))) {
    throw new Error("Inactive member cannot edit availability");
  }
  return { teamId, personId };
}

/** A member toggling *their own* whole-day unavailability. */
export async function toggleMyUnavailabilityAction(formData: FormData) {
  const { teamId, personId } = await requireOwnEditablePerson(formData);
  await setUnavailable(
    teamId,
    personId,
    requireDate(formData.get("date")),
    formData.get("unavailable") === "1",
  );
  revalidatePath("/shifts", "layout");
}

export async function toggleShiftUnavailableAction(formData: FormData) {
  const { teamId } = await requireAdmin();
  await setUnavailableShift(
    teamId,
    requireId(formData.get("personId")),
    requireDate(formData.get("date")),
    requireShift(formData.get("shift")),
    formData.get("unavailable") === "1",
  );
  revalidatePath("/shifts", "layout");
}

/** Member editing *their own* per-shift availability. */
export async function toggleMyShiftUnavailabilityAction(formData: FormData) {
  const { teamId, personId } = await requireOwnEditablePerson(formData);
  await setUnavailableShift(
    teamId,
    personId,
    requireDate(formData.get("date")),
    requireShift(formData.get("shift")),
    formData.get("unavailable") === "1",
  );
  revalidatePath("/shifts", "layout");
}

export async function blockWeekAction(formData: FormData) {
  const { teamId } = await requireAdmin();
  await setWeekUnavailable(
    teamId,
    requireId(formData.get("personId")),
    requireWeekStart(formData.get("weekStart")),
    formData.get("blocked") === "1",
  );
  revalidatePath("/shifts", "layout");
}

/** Member blocking/clearing *their own* whole week. */
export async function blockMyWeekAction(formData: FormData) {
  const { teamId, personId } = await requireOwnEditablePerson(formData);
  await setWeekUnavailable(
    teamId,
    personId,
    requireWeekStart(formData.get("weekStart")),
    formData.get("blocked") === "1",
  );
  revalidatePath("/shifts", "layout");
}

// ---- schedule ----

export async function generateWeekAction(formData: FormData) {
  const { teamId } = await requireAdmin();
  const weekStart = requireDate(formData.get("weekStart"));
  // Schedules are live-edited — there is no publish gate. Overwriting manual
  // tweaks is guarded in the UI by a "Regenerate" confirm, not a server flag.
  const seed = Date.now() % 2 ** 31;
  const result = generateWeek({
    weekStart,
    people: await listPeople(teamId),
    constraints: await listConstraintsForWeek(teamId, weekStart),
    history: await historyBefore(teamId, weekStart),
    seed,
  });
  await replaceWeekAssignments(teamId, weekStart, result.assignments);
  revalidatePath("/shifts", "layout");
}

export async function assignSlotAction(formData: FormData) {
  const { teamId } = await requireAdmin();
  const { weekStart, date } = requireWeekDate(
    formData.get("weekStart"),
    formData.get("date"),
  );
  const slot = requireSlot(formData.get("slot"));
  const personId = requireId(formData.get("personId"));
  const previousId = Number(formData.get("previousPersonId"));
  await swapSeat(
    teamId,
    weekStart,
    date,
    slot,
    Number.isInteger(previousId) && previousId > 0 ? previousId : null,
    personId,
  );
  revalidatePath("/shifts", "layout");
}

export async function clearSlotAction(formData: FormData) {
  const { teamId } = await requireAdmin();
  const date = requireDate(formData.get("date"));
  const slot = requireSlot(formData.get("slot"));
  await removeAssignment(teamId, weekStartOf(date), {
    date,
    slot,
    personId: requireId(formData.get("personId")),
  });
  revalidatePath("/shifts", "layout");
}

export async function goToWeekAction(formData: FormData) {
  redirect(`/shifts/week/${requireDate(formData.get("weekStart"))}`);
}
