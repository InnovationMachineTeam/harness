import { redirect } from "next/navigation";

/** Стартовая страница консоли - раздел "Агент". Страница Roadmap удалена. */
export default function HomeRedirect() {
  redirect("/agent");
}
