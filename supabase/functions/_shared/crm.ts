// Puts people into the CRM's contacts table (same Supabase project) so sales
// can see them in the CRM, and keeps the "Bought a course" list up to date so
// buyers can be upsold later.
//
// Used by academy-stripe (buyers) and meta-leads (Facebook and Instagram lead
// forms). Matches by email within brand_id 'clickclick', the same dedupe rule
// academy-progress uses, so one person is one contact however they arrived.
//
// Best effort, always: a CRM hiccup must never stop a buyer getting their
// code or a lead getting their email. Every caller wraps it and moves on.

import type { createClient } from "jsr:@supabase/supabase-js@2"

type AdminClient = ReturnType<typeof createClient>

export const BOUGHT_LIST = "Bought a course"

export async function upsertContact(admin: AdminClient, c: {
  email: string
  name?: string | null
  source: string
  tags: string[]
  note: string
  stage?: "new" | "won"
}) {
  const email = c.email.trim().toLowerCase()
  if (!email) return null

  const { data: found, error: findErr } = await admin
    .from("contacts")
    .select("id, tags, notes, stage, name")
    .ilike("email", email)
    .eq("brand_id", "clickclick")
    .limit(1)
  if (findErr) throw findErr
  const existing = found?.[0] as
    | { id: string; tags: string[] | null; notes: string | null; stage: string; name: string | null }
    | undefined

  if (existing) {
    const tags = Array.from(new Set([...(existing.tags ?? []), ...c.tags]))
    // Each note is added once. The same webhook firing twice, or a lead being
    // fetched again, must not stack the same line up in their notes.
    const notes = existing.notes?.includes(c.note)
      ? existing.notes
      : [existing.notes?.trim(), c.note].filter(Boolean).join("\n\n")
    const patch: Record<string, unknown> = { tags, notes, updated_at: new Date().toISOString() }
    // Only ever moves forward to won. A contact sales already moved to
    // "talking" is not dragged back to "new" by a second form fill.
    if (c.stage === "won") patch.stage = "won"
    if (!existing.name && c.name) patch.name = c.name
    const { error } = await admin.from("contacts").update(patch).eq("id", existing.id)
    if (error) throw error
    return existing.id
  }

  const { data: made, error: insErr } = await admin
    .from("contacts")
    .insert({
      name: c.name || email,
      email,
      phone: "",
      company: "",
      stage: c.stage ?? "new",
      source: c.source,
      tags: Array.from(new Set(c.tags)),
      notes: c.note,
      brand_id: "clickclick",
    })
    .select("id")
    .single()
  if (insErr) throw insErr
  return (made as { id: string }).id
}

export async function addToList(admin: AdminClient, listName: string, contactId: string) {
  const { data: list, error } = await admin
    .from("dialer_lists")
    .select("id")
    .eq("name", listName)
    .limit(1)
  if (error) throw error
  const listId = (list?.[0] as { id: string } | undefined)?.id
  if (!listId) throw new Error(`No CRM list called "${listName}".`)
  const { error: addErr } = await admin
    .from("dialer_list_members")
    .upsert({ list_id: listId, contact_id: contactId }, { onConflict: "list_id,contact_id", ignoreDuplicates: true })
  if (addErr) throw addErr
}
