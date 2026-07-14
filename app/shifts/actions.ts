"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireLinkedMember } from "@/lib/auth";
import {
  addPerson,
  historyBefore,
  isWeekPublished,
  linkPersonToUser,
  listConstraintsForWeek,
  listPeople,
  removeAssignment,
  renamePerson,
  replaceWeekAssignments,
  setPersonActive,
  setUnavailable,
  setWeekPublished,
  swapSeat,
  unlinkPerson,
} from "@/lib/db/queries";
import { generateWeek } from "@/lib/scheduler/generate";
import type { SlotType } from "@/lib/shifts/types";
import { SLOT_TYPES } from "@/lib/shifts/types";
import { isIsoDate, sundayOf } from "@/lib/shifts/week";

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

/** A date plus the Sunday of the week it must belong to. */
function requireWeekDate(
  weekValue: FormDataEntryValue | null,
  dateValue: FormDataEntryValue | null,
): { weekStart: string; date: string } {
  const weekStart = requireDate(weekValue);
  const date = requireDate(dateValue);
  if (sundayOf(date) !== weekStart) {
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
 * A member toggling *their own* unavailability. The caller's person is resolved
 * server-side from their Clerk identity (`requireLinkedMember`); the form's
 * `personId` is only accepted if it matches — a spoofed id is rejected, never
 * trusted. Unlinked members are refused (requireLinkedMember throws).
 */
export async function toggleMyUnavailabilityAction(formData: FormData) {
  const { teamId, personId } = await requireLinkedMember();
  if (requireId(formData.get("personId")) !== personId) {
    throw new Error("Cannot edit another person's availability");
  }
  await setUnavailable(
    teamId,
    personId,
    requireDate(formData.get("date")),
    formData.get("unavailable") === "1",
  );
  revalidatePath("/shifts", "layout");
}

// ---- schedule ----

export async function generateWeekAction(formData: FormData) {
  const { teamId } = await requireAdmin();
  const weekStart = requireDate(formData.get("weekStart"));
  // Never regenerate a live schedule out from under viewers (and manual
  // tweaks); the UI disables the button, this guards direct POSTs.
  if (await isWeekPublished(teamId, weekStart)) return;
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
  await removeAssignment(teamId, sundayOf(date), {
    date,
    slot,
    personId: requireId(formData.get("personId")),
  });
  revalidatePath("/shifts", "layout");
}

export async function setPublishedAction(formData: FormData) {
  const { teamId } = await requireAdmin();
  const weekStart = requireDate(formData.get("weekStart"));
  await setWeekPublished(teamId, weekStart, formData.get("published") === "1");
  revalidatePath("/shifts", "layout");
}

export async function goToWeekAction(formData: FormData) {
  redirect(`/shifts/week/${requireDate(formData.get("weekStart"))}`);
}
