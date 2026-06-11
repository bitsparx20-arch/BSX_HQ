import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSessionGuard } from "@/hooks/useSessionGuard";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Prohibit } from "@phosphor-icons/react";

export default function SessionGuard({ children }) {
  const { user } = useAuth();
  const { tabBlocked } = useSessionGuard(user);

  const closeTab = () => {
    window.close();
    setTimeout(() => window.location.reload(), 300);
  };

  return (
    <>
      {children}
      <AlertDialog open={!!user && tabBlocked}>
        <AlertDialogContent className="max-w-sm" onEscapeKeyDown={(e) => e.preventDefault()}>
          <AlertDialogHeader className="items-center text-center sm:items-center sm:text-center">
            <Prohibit size={36} className="text-amber-500 mb-1" weight="duotone" />
            <AlertDialogTitle>Only one tab allowed</AlertDialogTitle>
            <AlertDialogDescription>
              This account is already open in another browser tab. Close this tab and continue in the other one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-center">
            <Button onClick={closeTab} className="bg-[var(--bx-brand)] hover:opacity-90 text-white w-full sm:w-auto">
              Close this tab
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
