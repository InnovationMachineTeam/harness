import { redirect } from "next/navigation";

/** Маршрут перенесен во вкладку "Роли" раздела "Агент". */
export default function RolesRedirect() {
  redirect("/agent?tab=roles");
}
