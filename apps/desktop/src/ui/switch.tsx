import { Switch as Radix } from "radix-ui";

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
};

export function Switch({ checked, onCheckedChange, label, disabled = false }: SwitchProps) {
  return (
    <Radix.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative inline-flex h-[18px] w-8 shrink-0 rounded-full bg-press transition-colors duration-220 data-[state=checked]:bg-brand disabled:opacity-45"
    >
      <Radix.Thumb className="block size-3.5 translate-x-0.5 translate-y-0.5 rounded-full bg-white shadow-[0_1px_2px_oklch(0_0_0/0.3)] transition-transform duration-220 ease-out data-[state=checked]:translate-x-4" />
    </Radix.Root>
  );
}
