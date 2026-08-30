import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

// Exercises the Azure Table tag cache (writeTags/getLastModified) and the
// revalidation flow for the /isr page.
export async function POST() {
    revalidatePath("/isr");
    return NextResponse.json({ revalidated: true, path: "/isr" });
}
