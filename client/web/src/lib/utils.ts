import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 0-padded 2-digit hex with 0x prefix: 0x3e, 0x0a, … */
export const hex2 = (n: number) => '0x' + n.toString(16).padStart(2, '0');
