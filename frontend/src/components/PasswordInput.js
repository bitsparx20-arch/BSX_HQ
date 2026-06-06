import React, { useState } from "react";
import { Eye, EyeSlash, Copy } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function PasswordInput({
  value = "",
  onChange,
  className,
  inputClassName,
  showCopy = true,
  ...props
}) {
  const [visible, setVisible] = useState(false);

  const copyPassword = async () => {
    if (!value) {
      toast.error("Nothing to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Password copied");
    } catch {
      toast.error("Could not copy password");
    }
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        className={cn(showCopy ? "pr-[4.5rem]" : "pr-11", inputClassName)}
        {...props}
      />
      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        {showCopy && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-[var(--bx-text-3)] hover:text-[var(--bx-text)]"
            onClick={copyPassword}
            aria-label="Copy password"
            tabIndex={-1}
          >
            <Copy size={14} />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-slate-500 hover:text-slate-800 hover:bg-slate-100"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          tabIndex={-1}
        >
          {visible ? <EyeSlash size={18} weight="regular" /> : <Eye size={18} weight="regular" />}
        </Button>
      </div>
    </div>
  );
}
