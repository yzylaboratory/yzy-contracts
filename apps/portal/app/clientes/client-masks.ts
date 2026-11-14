import type { KeyboardEvent } from "react";

/**
 * Formats a Dominican Cédula into XXX-XXXXXXX-X.
 * Extracts up to 11 digits and formats as:
 * - 1-3 digits: XXX
 * - 4-10 digits: XXX-XXXXXXX
 * - 11 digits: XXX-XXXXXXX-X
 */
export function formatCedula(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10, 11)}`;
}

/**
 * Formats a 10-digit Dominican / NANP phone number into XXX-XXX-XXXX.
 * Strips leading country code "1" if 11 digits are provided.
 * Formats as:
 * - 1-3 digits: XXX
 * - 4-6 digits: XXX-XXX
 * - 7-10 digits: XXX-XXX-XXXX
 */
export function formatPhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  digits = digits.slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

export function displayClientIdentity(value: string): string {
  return /^[\d\s-]+$/.test(value) && value.replace(/\D/g, "").length === 11
    ? formatCedula(value) : value;
}

export function displayClientPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return /^[\d\s()+-]+$/.test(value) && (digits.length === 10 || /^1\d{10}$/.test(digits))
    ? formatPhone(value) : value;
}

/**
 * Handles Backspace when the cursor is immediately after a hyphen in a masked input,
 * ensuring the digit before the hyphen is removed seamlessly.
 */
export function handleMaskedBackspace(
  event: KeyboardEvent<HTMLInputElement>,
  formatter: (val: string) => string,
  onUpdate: (val: string) => void
) {
  if (event.key !== "Backspace") return;
  const input = event.currentTarget;
  const { selectionStart, selectionEnd, value } = input;
  if (selectionStart !== null && selectionStart === selectionEnd && selectionStart > 0) {
    if (value[selectionStart - 1] === "-") {
      event.preventDefault();
      const beforeHyphen = value.slice(0, selectionStart - 1);
      const afterHyphen = value.slice(selectionStart);
      const newRaw = beforeHyphen.slice(0, -1) + afterHyphen;
      const formatted = formatter(newRaw);
      onUpdate(formatted);
      const nextCursor = Math.max(0, selectionStart - 2);
      requestAnimationFrame(() => {
        input.setSelectionRange(nextCursor, nextCursor);
      });
    }
  }
}
