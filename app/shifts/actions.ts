"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addPerson,
  historyBefore,
  isWeekPublished,
  listConstraintsForWeek,
  listPeople,
  removeAssignment,
  renamePerson,
  replaceWeekAssignments,
  setPersonActive,
  setUnavailable,
  setWeekPublished,
  swapSeat,
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
  const name = String(formData.get("name") ?? "").trim();
  if (name) addPerson(name);
  revalidatePath("/shifts", "layout");
}

export async function renamePersonAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (name) renamePerson(requireId(formData.get("personId")), name);
  revalidatePath("/shifts", "layout");
  // A renamed/deactivated person changes what the published share page shows.
  revalidatePath("/s/[token]", "page");
}

export async function setPersonActiveAction(formData: FormData) {
  setPersonActive(requireId(formData.get("personId")), formData.get("active") === "1");
  revalidatePath("/shifts", "layout");
  revalidatePath("/s/[token]", "page");
}

// ---- unavailability ----

export async function toggleUnavailableAction(formData: FormData) {
  setUnavailable(
    requireId(formData.get("personId")),
    requireDate(formData.get("date")),
    formData.get("unavailable") === "1",
  );
  revalidatePath("/shifts", "layout");
}

// ---- schedule ----

export async function generateWeekAction(formData: FormData) {
  const weekStart = requireDate(formData.get("weekStart"));
  // Never regenerate a live schedule out from under viewers (and manual
  // tweaks); the UI disables the button, this guards direct POSTs.
  if (isWeekPublished(weekStart)) return;
  const seed = Date.now() % 2 ** 31;
  const result = generateWeek({
    weekStart,
    people: listPeople(),
    constraints: listConstraintsForWeek(weekStart),
    history: historyBefore(weekStart),
    seed,
  });
  replaceWeekAssignments(weekStart, result.assignments);
  revalidatePath("/shifts", "layout");
}

export async function assignSlotAction(formData: FormData) {
  const { weekStart, date } = requireWeekDate(
    formData.get("weekStart"),
    formData.get("date"),
  );
  const slot = requireSlot(formData.get("slot"));
  const personId = requireId(formData.get("personId"));
  const previousId = Number(formData.get("previousPersonId"));
  swapSeat(
    weekStart,
    date,
    slot,
    Number.isInteger(previousId) && previousId > 0 ? previousId : null,
    personId,
  );
  revalidatePath("/shifts", "layout");
  revalidatePath("/s/[token]", "page");
}

export async function clearSlotAction(formData: FormData) {
  const date = requireDate(formData.get("date"));
  const slot = requireSlot(formData.get("slot"));
  removeAssignment({ date, slot, personId: requireId(formData.get("personId")) });
  revalidatePath("/shifts", "layout");
  revalidatePath("/s/[token]", "page");
}

export async function setPublishedAction(formData: FormData) {
  const weekStart = requireDate(formData.get("weekStart"));
  setWeekPublished(weekStart, formData.get("published") === "1");
  revalidatePath("/shifts", "layout");
  revalidatePath("/s/[token]", "page");
}

export async function goToWeekAction(formData: FormData) {
  redirect(`/shifts/week/${requireDate(formData.get("weekStart"))}`);
}
