"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCategory } from "../../../lib/actions.ts";

export function DeleteCategoryButton({ categoryName }: { categoryName: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    if (window.confirm(`Are you sure you want to delete the category "${categoryName}"? Any transactions assigned to it will remain, but will lose their custom color/icon settings.`)) {
      startTransition(async () => {
        await deleteCategory(categoryName);
        router.push("/categories");
      });
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={isPending}
      style={{
        padding: "0.4rem 0.8rem",
        fontSize: "0.875rem",
        fontWeight: 600,
        color: "#dc2626",
        background: "transparent",
        border: "1px solid #fca5a5",
        borderRadius: 6,
        cursor: "pointer",
        opacity: isPending ? 0.5 : 1,
        marginLeft: "auto",
      }}
    >
      {isPending ? "Deleting..." : "Delete Category"}
    </button>
  );
}
