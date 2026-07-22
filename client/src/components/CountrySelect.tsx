import { useState } from "react";
import { Check, ChevronsUpDown, Globe } from "lucide-react";
import { COUNTRIES } from "@shared/schema";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Searchable destination-country selector (name + ISO code) used at checkout
 * to determine EU vs non-EU status and the shipping estimate.
 */
export function CountrySelect({
  value,
  onChange,
  testId = "select-destination-country",
}: {
  value: string;
  onChange: (code: string) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = COUNTRIES.find((c) => c.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={testId}
        >
          <span className="flex items-center gap-2 truncate">
            <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {selected ? `${selected.name} (${selected.code})` : "Select destination country"}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search country..." data-testid="input-country-search" />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {COUNTRIES.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.name} ${c.code}`}
                  onSelect={() => {
                    onChange(c.code);
                    setOpen(false);
                  }}
                  data-testid={`option-country-${c.code}`}
                >
                  <Check className={cn("h-3.5 w-3.5", value === c.code ? "opacity-100" : "opacity-0")} />
                  {c.name}
                  <span className="ml-auto text-xs text-muted-foreground">{c.code}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
