import { redirect } from "next/navigation";

/** Маршрут перенесен во вкладку "Workflow" раздела "Агент". */
export default function WorkflowsRedirect() {
  redirect("/agent?tab=workflow");
}
