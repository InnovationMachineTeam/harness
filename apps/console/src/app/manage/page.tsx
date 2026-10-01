import { redirect } from "next/navigation";

/** Прежняя объединённая страница разделена на "Навыки" и "MCP". */
export default function ManagePage() {
  redirect("/skills");
}
