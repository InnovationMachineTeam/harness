import { redirect } from "next/navigation";

/** Маршрут перенесен во вкладку "Задачи" раздела "Агент". */
export default function TasksRedirect() {
  redirect("/agent?tab=tasks");
}
